import path from "node:path"
import type { BrowserContext, WebSocketRoute } from "@playwright/test"
import { expect, test } from "./fixtures"

/**
 * Todo 18 acceptance (spec L162-L171, L589, §11.1-§11.2, §13.9.6): the
 * realtime manager reconnects with the capped backoff, drives the connection
 * dot green/amber/red, surfaces the polling banner only after the 12-attempt
 * ceiling, and handles close `4001` as refresh-once → reconnect / second →
 * logout.
 *
 * Failure injection is CLIENT-SIDE ONLY via `page.routeWebSocket`; the core
 * service is never stopped. The shared `storageState` is reused, so the suite
 * performs no additional login POSTs. Destructive flow (the forced `4001`
 * logout) runs in this test's own browser context, so the seeded session file
 * is untouched.
 */

const EVIDENCE_DIR = path.resolve(import.meta.dirname, "../../../.omo/evidence")
const DOT = '[data-testid="connection-dot"]'
const OFFLINE_COPY = "Live updates offline — polling every 15s"
const REFRESH_BODY = JSON.stringify({
  user: { id: 1, username: "admin", role: "admin", display_name: null },
  client: null,
})

/** Spec L171: 1→2→4→8→16→30s cap, 12 attempts total (6 flat 30s retries). */
const BACKOFF_DELAYS_MS = [
  1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000, 30000, 30000, 30000,
] as const

function eventRouteCollector(collector: WebSocketRoute[]): (ws: WebSocketRoute) => void {
  return (ws) => {
    if (ws.url().endsWith("/ws/events")) collector.push(ws)
  }
}

async function withTrace(
  context: BrowserContext,
  fileName: string,
  body: () => Promise<void>,
): Promise<void> {
  await context.tracing.start({ screenshots: true, snapshots: true })
  try {
    await body()
  } finally {
    await context.tracing.stop({ path: path.join(EVIDENCE_DIR, fileName) })
  }
}

test.describe("realtime socket manager", () => {
  test("happy: a server close reconnects and the dot returns to live", async ({
    context,
    page,
  }) => {
    await withTrace(context, "task-18-reconnect-trace.zip", async () => {
      const eventRoutes: WebSocketRoute[] = []
      await page.routeWebSocket("**/ws/**", (ws) => {
        ws.connectToServer()
        if (ws.url().endsWith("/ws/events")) eventRoutes.push(ws)
      })

      await page.goto("/sessions")
      const dot = page.locator(DOT)
      await expect(dot).toHaveAttribute("data-status", "live")

      await eventRoutes[0]?.close({ code: 1013, reason: "server restarting" })
      await expect(dot).toHaveAttribute("data-status", "reconnecting")
      await expect(dot).toHaveAttribute("data-status", "live", { timeout: 5_000 })

      await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-18-reconnect-live.png") })
    })
  })

  test("failure: 12 exhausted attempts turn the dot amber→red and raise the polling banner", async ({
    page,
  }) => {
    test.slow()
    await page.clock.install()

    const eventRoutes: WebSocketRoute[] = []
    let failConnections = true
    await page.routeWebSocket("**/ws/**", (ws) => {
      if (!ws.url().endsWith("/ws/events")) return
      // Emulate an unreachable server: the handshake never completes, so every
      // reconnect counts as a FAILED attempt and the 12-attempt ceiling applies.
      eventRoutes.push(ws)
      if (failConnections) void ws.close({ code: 1013, reason: "server restarting" })
    })

    await page.goto("/sessions")
    const dot = page.locator(DOT)
    const banner = page.getByText(OFFLINE_COPY)

    await expect(dot).toHaveAttribute("data-status", "reconnecting")
    await expect(banner).toHaveCount(0)

    for (const delay of BACKOFF_DELAYS_MS) {
      const expectedRoutes = eventRoutes.length + 1
      await page.clock.fastForward(delay)
      await expect.poll(() => eventRoutes.length).toBe(expectedRoutes)
    }

    await expect(dot).toHaveAttribute("data-status", "offline")
    await expect(banner).toBeVisible()
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-18-offline-banner.png") })

    failConnections = false
    await page.getByRole("button", { name: "Retry" }).click()
    await expect(dot).toHaveAttribute("data-status", "live", { timeout: 5_000 })
    await expect(banner).toHaveCount(0)
  })

  test("failure: a forced 4001 refreshes exactly once, then the second one logs out", async ({
    page,
  }) => {
    let refreshCalls = 0
    await page.route("**/auth/refresh", async (route) => {
      refreshCalls += 1
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: REFRESH_BODY,
      })
    })

    const eventRoutes: WebSocketRoute[] = []
    await page.routeWebSocket("**/ws/**", eventRouteCollector(eventRoutes))

    await page.goto("/sessions")
    const dot = page.locator(DOT)
    await expect(dot).toHaveAttribute("data-status", "live")

    await eventRoutes[0]?.close({ code: 4001, reason: "token expired" })
    await expect.poll(() => refreshCalls).toBe(1)
    await expect.poll(() => eventRoutes.length).toBe(2)
    await expect(dot).toHaveAttribute("data-status", "live")

    await eventRoutes[1]?.close({ code: 4001, reason: "token still rejected" })
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByText("Session expired")).toBeVisible()
    expect(refreshCalls).toBe(1)

    const routesAfterLogout = eventRoutes.length
    await page.waitForTimeout(1_500)
    expect(eventRoutes.length).toBe(routesAfterLogout)

    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-18-forced-4001-login.png") })
  })
})
