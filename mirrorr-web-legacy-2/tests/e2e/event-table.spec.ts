/**
 * Todo 19 acceptance (spec L165-L189, §11.1): the subject table applies
 * cross-client frames to the caches, coalesces bursts, and a data-less frame
 * refetches exactly once without blanking the open view.
 *
 * Happy path: a profile created through context A's UI appears in context B
 * without a manual refresh, over the real `/ws/events` socket.
 *
 * Failure path: stubbed session REST + a client-side injected WebSocket frame
 * (the core service is never stopped) proves the data-less `session.updated`
 * reaction is one targeted refetch while the view keeps rendering.
 */
import path from "node:path"
import type { APIRequestContext, BrowserContext, Page, WebSocketRoute } from "@playwright/test"
import { expect, test, stubCatalogs, stubSessionList, type SessionSeed } from "./fixtures"

const EVIDENCE_DIR = path.resolve(import.meta.dirname, "../../../.omo/evidence")
const DOT = '[data-testid="connection-dot"]'
const PROFILE_PREFIX = "e2e profile"
const DETAIL_SESSION_ID = 913

interface ProfileRow {
  readonly id: number
  readonly name: string
}

async function cookieHeaderFor(page: Page): Promise<Record<string, string>> {
  const cookies = await page.context().cookies()
  const value = cookies.find((cookie) => cookie.name === "mirrorr_access_token")?.value
  if (value === undefined) throw new Error("auth cookie missing — run through auth.setup storageState")
  return { Cookie: `mirrorr_access_token=${value}` }
}

async function listProfiles(api: APIRequestContext, headers: Record<string, string>): Promise<ProfileRow[]> {
  const response = await api.get("/api/profiles/?limit=200", { headers })
  if (response.status() !== 200) return []
  const body = (await response.json()) as { items?: ProfileRow[] }
  return body.items ?? []
}

async function deleteProfile(api: APIRequestContext, id: number, headers: Record<string, string>): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await api.delete(`/api/profiles/${id}`, { headers })
    const probe = await api.get(`/api/profiles/${id}`, { headers })
    if (probe.status() === 404) return
    await new Promise((resolve) => setTimeout(resolve, 1_500))
  }
  throw new Error(`cleanup failed: profile ${id} still present`)
}

async function sweepTestProfiles(api: APIRequestContext, headers: Record<string, string>): Promise<void> {
  for (const row of await listProfiles(api, headers)) {
    if (row.name.startsWith(PROFILE_PREFIX)) await deleteProfile(api, row.id, headers)
  }
}

function countLoginPosts(page: Page): () => number {
  let count = 0
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/auth/login") count += 1
  })
  return () => count
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

const DETAIL_SESSION: SessionSeed = {
  id: DETAIL_SESSION_ID,
  status: "active",
  engine_id: 1,
  resolver_id: 1,
  session_urls: [],
  attempts: [],
}

test.describe("event table and cross-client coherence", () => {
  test("happy: a profile created in one context appears in the other without a refresh", async ({
    browser,
    context,
    page,
  }) => {
    test.setTimeout(180_000)
    const api = page.context().request
    const headers = await cookieHeaderFor(page)
    const name = `${PROFILE_PREFIX} coherence ${Date.now()}`
    const loginPosts = countLoginPosts(page)

    const otherContext = await browser.newContext({
      storageState: await page.context().storageState(),
      baseURL: new URL(page.url()).origin,
    })
    const otherPage = await otherContext.newPage()
    const otherLoginPosts = countLoginPosts(otherPage)

    try {
      await sweepTestProfiles(api, headers)

      await withTrace(context, "task-19-two-context-trace.zip", async () => {
        await page.goto("/profiles")
        await otherPage.goto("/profiles")
        await expect(page.getByTestId("profiles-view")).toBeVisible()
        await expect(otherPage.getByTestId("profiles-view")).toBeVisible()
        await expect(page.locator(DOT)).toHaveAttribute("data-status", "live")
        await expect(otherPage.locator(DOT)).toHaveAttribute("data-status", "live")

        await page.getByRole("button", { name: "New profile" }).click()
        await page.getByLabel("Name").fill(name)
        await page.getByLabel("Engine").selectOption({ label: "yt_dlp_piped" })
        await page.getByLabel("Resolver").selectOption({ label: "static" })
        await page.getByLabel("Url").fill("https://example.com/e2e-event-table.m3u8")
        await page.getByRole("button", { name: "Create profile" }).click()
        await expect(page.getByText(`Profile "${name}" created`)).toBeVisible()

        const otherRow = otherPage.locator('[data-testid^="profile-name-"]').filter({ hasText: name })
        await expect(otherRow).toBeVisible({ timeout: 10_000 })
        await otherPage.screenshot({ path: path.join(EVIDENCE_DIR, "task-19-two-context.png") })
      })

      expect(loginPosts()).toBe(0)
      expect(otherLoginPosts()).toBe(0)
    } finally {
      await otherContext.close()
      await sweepTestProfiles(api, headers)
    }
  })

  test("failure: a data-less session.updated refetches exactly once and never blanks the view", async ({
    page,
  }) => {
    await stubCatalogs(page)
    await stubSessionList(page, [DETAIL_SESSION])

    let detailGets = 0
    await page.route(`**/api/sessions/${DETAIL_SESSION_ID}`, async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback()
        return
      }
      detailGets += 1
      // Delay every refetch so the "never blanks" guarantee is observable.
      if (detailGets > 1) await new Promise((resolve) => setTimeout(resolve, 300))
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Cache-Control": "no-store" },
        body: JSON.stringify(DETAIL_SESSION),
      })
    })

    const eventRoutes: WebSocketRoute[] = []
    await page.routeWebSocket("**/ws/**", (ws) => {
      ws.connectToServer()
      if (ws.url().endsWith("/ws/events")) eventRoutes.push(ws)
    })

    await page.goto(`/sessions/${DETAIL_SESSION_ID}`)
    await expect(page.locator(DOT)).toHaveAttribute("data-status", "live")
    await expect(page.getByTestId("session-detail")).toBeVisible()
    await expect(page.getByTestId("session-id")).toHaveText(`#${DETAIL_SESSION_ID}`)
    await expect(page.getByTestId("status-chip")).toHaveText("Running")

    const before = detailGets
    const dataLessFrame = JSON.stringify({ type: "event", event: "session.updated", id: DETAIL_SESSION_ID })
    await eventRoutes[0]?.send(dataLessFrame)
    await eventRoutes[0]?.send(dataLessFrame)

    await expect(page.getByTestId("session-detail")).toBeVisible()
    await expect(page.getByTestId("status-chip")).toHaveText("Running")
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-19-dataless-refetch.png") })

    await expect.poll(() => detailGets).toBe(before + 1)
    await page.waitForTimeout(600)
    expect(detailGets).toBe(before + 1)
    await expect(page.getByTestId("session-detail")).toBeVisible()
    await expect(page.getByTestId("status-chip")).toHaveText("Running")
  })
})
