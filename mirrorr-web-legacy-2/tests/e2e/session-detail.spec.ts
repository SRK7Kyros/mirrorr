/**
 * V4 acceptance (spec L267-L277, L181-L185, L208):
 * - real dev core: a seeded session renders the "Live URLs unavailable" copy
 *   (the core has no `web_url`), a populated attempts timeline, the two-column
 *   layout at >=1100px (stacked below), and a read-only config panel;
 * - real delete: a session created by this suite vanishes on delete only after
 *   the server confirms it gone, and the list no longer shows it;
 * - stubbed payload: labelled Live URLs with copy + "Open in new tab";
 * - stubbed 204 delete under `page.clock`: "Deleting…" holds until the 15s poll
 *   observes the 404 (a 204 is not "gone");
 * - invalid id: "Session not found" + a back link.
 */
import path from "node:path"
import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"

const EVIDENCE_DIR = path.resolve(import.meta.dirname, "../../../.omo/evidence")
const SEED_SESSION_ID = 1
const STUB_SESSION_ID = 77

test.use({ trace: "on" })

const STUB_SESSION = {
  id: STUB_SESSION_ID,
  engine_id: 1,
  resolver_id: 1,
  engine_name: "yt_dlp_piped",
  resolver_name: "static",
  status: "completed",
  recording: false,
  retry_attempts: 0,
  started_at: null,
  ended_at: null,
  requester_user_token: "admin",
  session_urls: [
    { m3u8: "https://example.test/live.m3u8" },
    { html: "https://example.test/live.html" },
    { outplayer: "https://example.test/live.opl" },
  ],
  attempts: [
    {
      index: 1,
      started_at: "2026-09-01T10:00:00",
      ended_at: "2026-09-01T10:00:05",
      duration_seconds: 5,
      returncode: 0,
      reason: null,
    },
  ],
  resolver_config: { url: "https://example.test/live.m3u8", headers: {} },
  retry_mode: "count",
  retry_config: { count: 3, delay: 1 },
}

const ENGINE_PAGE = {
  items: [{ id: 1, name: "yt_dlp_piped", capabilities: { can_record: true } }],
  next_cursor: null,
  has_more: false,
}

async function stubSessionDetail(
  page: Page,
  options: { readonly deleteStatus: number; readonly goneAfterDelete: boolean },
): Promise<void> {
  let deleted = false
  await page.route("**/api/**", async (route) => {
    const url = route.request().url()
    const method = route.request().method()

    if (url.includes(`/api/sessions/${STUB_SESSION_ID}`)) {
      if (method === "DELETE") {
        deleted = true
        await route.fulfill({ status: options.deleteStatus })
        return
      }
      if (deleted && options.goneAfterDelete) {
        await route.fulfill({ status: 404, json: { detail: "session not found" } })
        return
      }
      await route.fulfill({ status: 200, json: STUB_SESSION })
      return
    }

    if (url.includes("/api/engines/")) {
      await route.fulfill({ status: 200, json: ENGINE_PAGE })
      return
    }

    await route.fallback()
  })
}

async function assertTwoColumn(page: Page): Promise<void> {
  const left = await page.getByTestId("session-detail-left").boundingBox()
  const right = await page.getByTestId("session-detail-right").boundingBox()
  expect(left).not.toBeNull()
  expect(right).not.toBeNull()
  if (left === null || right === null) return
  expect(left.x + left.width).toBeLessThanOrEqual(right.x + 1)
  expect(Math.abs(left.y - right.y)).toBeLessThanOrEqual(2)
}

async function assertStacked(page: Page): Promise<void> {
  const left = await page.getByTestId("session-detail-left").boundingBox()
  const right = await page.getByTestId("session-detail-right").boundingBox()
  expect(left).not.toBeNull()
  expect(right).not.toBeNull()
  if (left === null || right === null) return
  expect(Math.abs(left.x - right.x)).toBeLessThanOrEqual(1)
  expect(right.y).toBeGreaterThanOrEqual(left.y + left.height - 1)
}

async function createTerminalSession(page: Page): Promise<number> {
  const created = await page.evaluate(async () => {
    const response = await fetch("/api/sessions/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        engine_id: 1,
        resolver_id: 1,
        resolver_config: { url: "https://example.com/e2e-task13-delete-me.m3u8" },
        retry_mode: "none",
        recording: false,
      }),
    })
    return { status: response.status, id: ((await response.json()) as { id: number }).id }
  })
  expect(created.status).toBeLessThan(300)
  const id = created.id

  const readStatus = () =>
    page.evaluate(async (sessionId) => {
      const response = await fetch(`/api/sessions/${sessionId}`)
      if (!response.ok) return "missing"
      const body = (await response.json()) as { status?: string }
      return body.status ?? "unknown"
    }, id)

  // Require the terminal status twice, 1.2s apart: the dev core can briefly
  // report `failed` between retry cycles and deleting mid-cycle is deferred.
  await expect
    .poll(
      async () => {
        const first = await readStatus()
        if (!/failed|completed/.test(first)) return first
        await new Promise((resolve) => setTimeout(resolve, 1200))
        const second = await readStatus()
        return `${first}->${second}`
      },
      { timeout: 60_000, intervals: [1000] },
    )
    .toMatch(/^(failed|completed)->(failed|completed)$/)

  return id
}

async function deleteSession(page: Page, id: number): Promise<void> {
  await page.evaluate(async (sessionId) => {
    await fetch(`/api/sessions/${sessionId}`, { method: "DELETE" })
  }, id)
}

test("real session: empty live URLs, attempts timeline, two-column layout, config read-only", async ({
  page,
}) => {
  await page.goto(`/sessions/${SEED_SESSION_ID}`)
  await expect(page.getByTestId("session-detail")).toBeVisible()

  const empty = page.getByTestId("live-urls-empty")
  await expect(empty).toContainText("Live URLs unavailable")
  await expect(empty).toContainText("web_url")
  await expect(page.getByTestId("live-url-link")).toHaveCount(0)
  await expect(page.getByTestId("status-chip")).toContainText("Failed")

  const attempts = page.getByTestId("attempt-row")
  await expect(attempts.first()).toBeVisible()
  expect(await attempts.count()).toBeGreaterThan(0)
  await expect(page.getByTestId("attempt-exit").first()).toContainText("exit 1")
  await expect(page.getByTestId("attempts-retry-count")).toBeVisible()

  await assertTwoColumn(page)
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, "task-13-session-detail.png"),
    fullPage: true,
  })

  await page.setViewportSize({ width: 900, height: 800 })
  await assertStacked(page)
  await page.setViewportSize({ width: 1280, height: 720 })

  expect(await page.getByTestId("config-panel").locator("input, textarea, select").count()).toBe(0)
  await expect(page.getByTestId("config-resolver")).toContainText("https://example.com/nonexistent-stream.m3u8")
  await page.getByTestId("config-panel").scrollIntoViewIfNeeded()
  await expect(page.getByTestId("config-retry-mode")).toContainText("count")

  await page.goto("/sessions")
  await expect(page.getByTestId("sessions-view")).toBeVisible()
  await expect(page.getByText(`#${SEED_SESSION_ID}`, { exact: true }).first()).toBeVisible()
})

test("real delete: Deleting… holds until the server confirms removal, then the list is clean", async ({
  page,
}) => {
  test.slow()
  await page.clock.install()
  const id = await createTerminalSession(page)
  try {
    await page.goto(`/sessions/${id}`)
    await expect(page.getByTestId("session-detail")).toBeVisible()
    await expect(page.getByTestId("status-chip")).toContainText("Failed", { timeout: 15_000 })
    await page.getByTestId("session-delete").click()
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click()
    await expect(page.getByTestId("session-deleting-overlay")).toBeVisible()

    // Drive the 15s poll fallback with the fake clock. A session whose
    // supervisor is still winding down can be re-created after a successful
    // DELETE, so re-issue the delete until the core confirms it stays gone.
    for (let attempt = 0; attempt < 10; attempt++) {
      await page.clock.fastForward(16_000)
      await page.waitForTimeout(1500)
      const stillThere = await page.evaluate(async (sessionId) => {
        const response = await fetch(`/api/sessions/${sessionId}`)
        if (response.status === 404) return false
        await fetch(`/api/sessions/${sessionId}`, { method: "DELETE" })
        return true
      }, id)
      if (!stillThere) break
    }
    await page.clock.fastForward(16_000)

    await expect(page).toHaveURL(/\/sessions$/, { timeout: 15_000 })
    await expect(page.getByTestId("sessions-view")).toBeVisible()
    await expect(page.getByText(`#${id}`, { exact: true })).toHaveCount(0)
  } finally {
    await deleteSession(page, id).catch(() => undefined)
  }
})

test("stubbed live URLs: labelled links, copy and open-in-new-tab", async ({ page }) => {
  await stubSessionDetail(page, { deleteStatus: 204, goneAfterDelete: true })
  await page.goto(`/sessions/${STUB_SESSION_ID}`)
  await expect(page.getByTestId("session-detail")).toBeVisible()

  await expect(page.getByTestId("live-url-row")).toHaveCount(3)
  await expect(page.getByTestId("live-url-copy")).toHaveCount(3)
  await expect(page.getByText("M3U8", { exact: true })).toBeVisible()
  await expect(page.getByText("HTML", { exact: true })).toBeVisible()
  await expect(page.getByText("Outplayer", { exact: true })).toBeVisible()

  const firstLink = page.getByTestId("live-url-link").first()
  await expect(firstLink).toContainText("Open in new tab")
  await expect(firstLink).toHaveAttribute("target", "_blank")
  await expect(firstLink).toHaveAttribute("href", "https://example.test/live.m3u8")

  expect(await page.getByTestId("config-panel").locator("input, textarea, select").count()).toBe(0)
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, "task-13-live-urls-stub.png"),
    fullPage: true,
  })
})

test("stubbed 204 delete: Deleting… holds through 14s and the 15s poll confirms removal", async ({
  page,
}) => {
  await page.clock.install()
  await stubSessionDetail(page, { deleteStatus: 204, goneAfterDelete: true })
  await page.goto(`/sessions/${STUB_SESSION_ID}`)
  await expect(page.getByTestId("session-detail")).toBeVisible()

  await page.getByTestId("session-delete").click()
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click()

  const overlay = page.getByTestId("session-deleting-overlay")
  await expect(overlay).toBeVisible()

  await page.clock.fastForward(14_000)
  await expect(overlay).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/sessions/${STUB_SESSION_ID}$`))

  await page.clock.fastForward(2_000)
  await expect(page).toHaveURL(/\/sessions$/, { timeout: 15_000 })
})

test("invalid id: Session not found with a back link", async ({ page }) => {
  await page.goto("/sessions/999999")
  await expect(page.getByTestId("session-not-found")).toBeVisible({ timeout: 15_000 })
  const back = page.getByTestId("back-to-sessions")
  await expect(back).toBeVisible()
  await expect(back).toHaveAttribute("href", "/sessions")
})
