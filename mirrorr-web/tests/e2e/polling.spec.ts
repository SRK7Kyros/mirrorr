/**
 * Todo 21 acceptance (spec L140, L154-L158, L171):
 * - after the 12-attempt reconnect ceiling the list polls at 15s and the first
 *   successful poll resumes live updates;
 * - an API-client principal shows its persistent banner + static 10s label and
 *   polls the visible list every 10s;
 * - the 30s backstop and WS frames never produce a duplicate-fetch storm.
 *
 * All failure injection is client-side (`page.routeWebSocket`); the fake clock
 * drives the 10s/15s/30s assertions. Login POSTs are counted: this suite must
 * add zero (the shared storageState comes from `auth.setup.ts`).
 */
import path from "node:path"
import type { Page, WebSocketRoute } from "@playwright/test"
import { expect, test, stubSessionList } from "./fixtures"

const EVIDENCE_DIR = path.resolve(import.meta.dirname, "../../../.omo/evidence")
const OFFLINE_COPY = "Live updates offline — polling every 15s"
const API_CLIENT_COPY =
  "Acting as API client 'ops-key' — created resources belong to no user and produce no notifications"
const API_CLIENT_LABEL = "API client — polling every 10s"
/** Spec L171: 1→2→4→8→16→30s(cap), 12 attempts total. */
const BACKOFF_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000, 30000, 30000, 30000]

interface RequestLog {
  readonly listGets: number[]
  logins: number
}

function trackRequests(page: Page): RequestLog {
  const log: RequestLog = { listGets: [], logins: 0 }
  page.on("request", (request) => {
    const url = new URL(request.url())
    if (request.method() === "GET" && url.pathname === "/api/sessions/") log.listGets.push(Date.now())
    if (request.method() === "POST" && url.pathname === "/auth/login") log.logins += 1
  })
  return log
}

/**
 * Advances the fake clock in 500ms steps until `target` list GETs are seen (or
 * the cap is hit) — each 10s/15s/30s window has a cap below the next cadence,
 * so a slower cadence or a stalled poller still fails.
 */
async function advanceUntilPoll(page: Page, log: RequestLog, target: number, capMs: number): Promise<void> {
  for (let advanced = 0; log.listGets.length < target && advanced < capMs; advanced += 500) {
    await page.clock.fastForward(500)
  }
  await expect.poll(() => log.listGets.length).toBeGreaterThanOrEqual(target)
}

test.describe.configure({ mode: "serial" })

test.describe("polling backstops", () => {
  test("failure: 12 exhausted attempts switch to 15s polling, a successful poll resumes live", async ({
    page,
  }) => {
    test.slow()
    await page.clock.install()
    const log = trackRequests(page)
    const eventRoutes: WebSocketRoute[] = []
    let failConnections = true

    // A full outage: REST polls fail too, so the outage cannot self-resume and
    // the offline banner stays observable (spec L171 resumes on the next
    // successful poll, which is the second half of this test).
    await page.route("**/api/sessions/**", (route) => {
      if (failConnections && route.request().method() === "GET") return route.abort()
      return route.fallback()
    })
    await page.routeWebSocket("**/ws/**", (ws) => {
      if (!ws.url().endsWith("/ws/events")) return
      eventRoutes.push(ws)
      if (failConnections) void ws.close({ code: 1013, reason: "server restarting" })
    })

    await page.goto("/sessions")
    const dot = page.locator('[data-testid="connection-dot"]')
    await expect(dot).toHaveAttribute("data-status", "reconnecting")

    for (const delay of BACKOFF_DELAYS_MS) {
      const expectedRoutes = eventRoutes.length + 1
      await page.clock.fastForward(delay)
      await expect.poll(() => eventRoutes.length).toBe(expectedRoutes)
    }

    await expect(dot).toHaveAttribute("data-status", "offline")
    await expect(page.getByText(OFFLINE_COPY)).toHaveCount(1)
    await expect(page.getByText("API unreachable — retrying")).toHaveCount(0)
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-21-offline-15s.png") })

    const beforePoll = log.listGets.length
    failConnections = false
    for (let advance = 0; advance < 3 && log.listGets.length === beforePoll; advance += 1) {
      await page.clock.fastForward(15_000)
    }
    await expect.poll(() => log.listGets.length).toBeGreaterThan(beforePoll)

    await expect(dot).toHaveAttribute("data-status", "live")
    await expect(page.getByText(OFFLINE_COPY)).toHaveCount(0)
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-21-resume-after-poll.png") })

    console.log(
      `[task-21] exhaustion-resume routes=${eventRoutes.length} listGets=${log.listGets.length} logins=${log.logins}`,
    )
    expect(log.logins).toBe(0)
  })

  test("failure: an API-client principal shows its banner and polls the list every 10s", async ({
    page,
  }) => {
    test.slow()
    await page.clock.install()
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Cache-Control": "no-store" },
        body: JSON.stringify({ user: null, client: { id: 7, name: "ops-key" } }),
      }),
    )
    const log = trackRequests(page)

    await stubSessionList(page, [])
    await page.goto("/sessions")
    await expect(page.getByTestId("api-client-banner")).toHaveText(API_CLIENT_COPY)
    await expect(page.getByTestId("api-client-polling-label")).toHaveText(API_CLIENT_LABEL)
    await expect(page.locator('[data-testid="connection-dot"]')).toHaveCount(0)
    await expect(page.getByTestId("notification-bell")).toHaveCount(0)
    await expect(page.getByText(OFFLINE_COPY)).toHaveCount(0)
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-21-api-client-banner.png") })

    await expect.poll(() => log.listGets.length).toBeGreaterThanOrEqual(1)
    await page.waitForTimeout(250)
    const baseline = log.listGets.length

    for (let tick = 1; tick <= 3; tick += 1) {
      await advanceUntilPoll(page, log, baseline + tick, 14_000)
    }
    expect(log.listGets.length).toBeLessThanOrEqual(baseline + 4)

    console.log(
      `[task-21] api-client ticks=${log.listGets.length - baseline} logins=${log.logins} baseline=${baseline}`,
    )
    expect(log.logins).toBe(0)
  })

  test("happy: the 30s backstop does not fight WS frames (no duplicate-fetch storm)", async ({
    page,
  }) => {
    test.slow()
    await page.clock.install()
    const log = trackRequests(page)
    let eventSocket: WebSocketRoute | null = null

    await page.routeWebSocket("**/ws/**", (ws) => {
      if (ws.url().endsWith("/ws/events")) eventSocket = ws
    })

    await stubSessionList(page, [])
    await page.goto("/sessions")
    await expect(page.locator('[data-testid="connection-dot"]')).toHaveAttribute("data-status", "live")
    await expect.poll(() => log.listGets.length).toBeGreaterThanOrEqual(1)
    await page.waitForTimeout(300)
    const settled = log.listGets.length

    await advanceUntilPoll(page, log, settled + 1, 34_000)
    const afterBackstop = log.listGets.length

    await eventSocket?.send(
      JSON.stringify({
        type: "event",
        event: "session.created",
        id: 9001,
        data: {
          id: 9001,
          status: "completed",
          engine_id: 1,
          resolver_id: 1,
          requester_user_token: "",
          recording: false,
        },
      }),
    )
    await expect(page.getByText("#9001")).toBeVisible()
    await page.waitForTimeout(300)
    expect(log.listGets.length).toBe(afterBackstop)

    await advanceUntilPoll(page, log, afterBackstop + 1, 34_000)
    expect(log.listGets.length).toBeLessThanOrEqual(settled + 3)
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-21-no-storm.png") })

    console.log(
      `[task-21] no-storm settled=${settled} afterBackstop=${afterBackstop} listGets=${log.listGets.length} logins=${log.logins}`,
    )
    expect(log.logins).toBe(0)
  })
})
