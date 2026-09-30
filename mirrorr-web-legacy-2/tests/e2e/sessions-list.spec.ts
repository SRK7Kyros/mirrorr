import { mkdirSync } from "node:fs"
import path from "node:path"
import {
  expect,
  test,
  stubCatalogs,
  stubSessionList,
  type SessionSeed,
} from "./fixtures"

/**
 * Task 12 acceptance (docs/web-frontend-spec.md L263-L273, L399-L408):
 * D1 creates a real session against the dev core, the row reaches a terminal
 * state with an attempts timeline, and the created session is deleted through
 * the API afterwards. The stream is synthetic (the dev core has no test stream
 * URL), so the reachable terminal state is `failed` — recorded in the
 * evidence file. Control failures are asserted against a stubbed 504.
 */
const EVIDENCE_DIR = path.resolve(import.meta.dirname, "../../../.omo/evidence")

test.use({ trace: "on" })

test("D1 creates a session, it reaches failed with attempts, and is deleted via the API", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto("/sessions")
  await page.getByTestId("new-session-primary").click()

  await page.getByRole("button", { name: "Custom" }).click()
  await page.getByLabel("Engine").selectOption({ label: "yt_dlp_piped" })
  await page.getByLabel("Resolver").selectOption({ label: "static" })
  await page.getByLabel(/^Url/).fill("https://example.com/nonexistent-stream.m3u8")
  await page.getByLabel("Retry mode").selectOption("count")
  await page.getByLabel(/^Delay/).fill("1")

  let created: { id: number; status: string } | null = null
  await page.route("**/api/sessions/", async (route) => {
    if (route.request().method() !== "POST") return route.fallback()
    const response = await route.fetch()
    created = (await response.json()) as { id: number; status: string }
    await route.fulfill({ response })
  })

  const createResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/sessions/",
  )
  await page.getByRole("button", { name: "Start session" }).click()
  await createResponse

  if (created === null) {
    throw new Error("POST /sessions/ response was not captured")
  }
  const session = created
  expect(session.status).toBe("active")
  await expect(page).toHaveURL(new RegExp(`/sessions/${session.id}$`))

  await expect
    .poll(
      () =>
        page.evaluate(async (sessionId) => {
          const response = await fetch(`/api/sessions/${sessionId}`)
          return ((await response.json()) as { status?: string }).status
        }, session.id),
      { timeout: 60_000 },
    )
    .toBe("failed")

  const detail = await page.evaluate(async (sessionId) => {
    const response = await fetch(`/api/sessions/${sessionId}`)
    return (await response.json()) as { attempts: readonly unknown[] }
  }, session.id)
  expect(detail.attempts.length).toBeGreaterThan(0)

  await page.goto("/sessions")
  const row = page.getByTestId("table-row").filter({ hasText: `#${session.id}` })
  await expect(row.getByTestId("status-chip")).toHaveText("Failed")

  mkdirSync(EVIDENCE_DIR, { recursive: true })
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-12-sessions-list.png") })

  const deleted = await page.evaluate(async (sessionId) => {
    const response = await fetch(`/api/sessions/${sessionId}`, { method: "DELETE" })
    return response.status
  }, session.id)
  expect(deleted).toBe(200)

  await page.reload()
  await expect(page.getByTestId("table-row").filter({ hasText: `#${session.id}` })).toHaveCount(0)
})

test("a stubbed 504 on stop shows the control-unavailable banner with force delete", async ({
  page,
}) => {
  const rows: readonly SessionSeed[] = [
    {
      id: 321,
      status: "active",
      engine_id: 1,
      resolver_id: 1,
      recording: true,
      started_at: "2026-09-19T10:00:00",
    },
  ]
  await stubSessionList(page, rows)
  await stubCatalogs(page)
  await page.route("**/api/sessions/321/stop", (route) =>
    route.fulfill({
      status: 504,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Session supervisor 321 is not responding" }),
    }),
  )

  await page.goto("/sessions")
  const row = page.getByTestId("table-row").filter({ hasText: "#321" })
  await row.getByRole("button", { name: "Stop" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Stop" }).click()

  await expect(row.getByTestId("control-unavailable-banner")).toContainText(
    "Control unavailable — session may be stuck",
  )
  await expect(row.getByRole("button", { name: "Force delete" })).toBeVisible()

  mkdirSync(EVIDENCE_DIR, { recursive: true })
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-12-control-unavailable.png") })
})

test("stop without a WS confirmation escalates to still-stopping + hard delete after 10s", async ({
  page,
}) => {
  await page.clock.install()

  const rows: readonly SessionSeed[] = [
    {
      id: 322,
      status: "active",
      engine_id: 1,
      resolver_id: 1,
      recording: true,
      started_at: "2026-09-19T10:00:00",
    },
  ]
  await stubSessionList(page, rows)
  await stubCatalogs(page)
  await page.route("**/api/sessions/322/stop", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }),
  )

  await page.goto("/sessions")
  const row = page.getByTestId("table-row").filter({ hasText: "#322" })
  await row.getByRole("button", { name: "Stop" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Stop" }).click()

  await expect(row.getByTestId("status-chip")).toHaveText("Stopping…")

  await page.clock.fastForward(10_000)

  await expect(row.getByTestId("still-stopping")).toBeVisible()
  await expect(row.getByRole("button", { name: "Force delete" })).toBeVisible()
})
