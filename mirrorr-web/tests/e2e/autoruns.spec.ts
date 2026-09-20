/**
 * Task 14 e2e — V5 `/autoruns`, V6 `/autoruns/{id}` and the D2 wizard.
 *
 * Real path: D2 creates a scheduled autorun (naive-UTC inputs, UTC hint,
 * past-start warning), "Run now" is composed as `POST /sessions/`, and the
 * spawned session reaches the degraded-but-real terminal `failed` state
 * (stream reality per todo 12). Everything created is deleted again.
 *
 * Stubbed paths (deterministic, no extra core data): the 10s countdown tick,
 * the live-edit lock (disabled fields + warning copy), the V6 linked-session
 * card from the cached scan, spent rows at 60% opacity, and Save as profile.
 * Export is deliberately absent until todo 23 wires it.
 */
import path from "node:path"
import type { APIRequestContext, Page } from "@playwright/test"
import { expect, test } from "./fixtures"

const EVIDENCE_DIR = path.resolve(import.meta.dirname, "../../../.omo/evidence")
const COUNTDOWN_TICK_MS = 10_000

function pad(value: number): string {
  return String(value).padStart(2, "0")
}

/** `datetime-local` wall value (browser and runner share the host zone). */
function localInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function naiveUtc(date: Date): string {
  return date.toISOString().slice(0, 19)
}

/**
 * The web build authenticates API calls with the `mirrorr_access_token`
 * cookie. Playwright's context request does not forward the Secure cookie over
 * http, so every probe sends it explicitly.
 */
async function cookieHeaderFor(page: Page): Promise<Record<string, string>> {
  const cookies = await page.context().cookies()
  const value = cookies.find((cookie) => cookie.name === "mirrorr_access_token")?.value
  if (value === undefined) throw new Error("auth cookie missing — run through auth.setup storageState")
  return { Cookie: `mirrorr_access_token=${value}` }
}

async function deleteUntilGone(
  api: APIRequestContext,
  url: string,
  headers: Record<string, string>,
): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await api.delete(url, { headers })
    const probe = await api.get(url, { headers })
    if (probe.status() === 404) return
    await new Promise((resolve) => setTimeout(resolve, 1_500))
  }
  throw new Error(`cleanup failed: ${url} still present`)
}

test("real: D2 creates a scheduled autorun, run-now spawns a session that reaches failed", async ({ page }) => {
  test.setTimeout(180_000)
  const api = page.context().request
  const headers = await cookieHeaderFor(page)
  const name = `e2e autorun ${Date.now()}`
  const snapshot = new Date()
  const start = new Date(snapshot.getTime() + 10 * 60_000)
  const end = new Date(snapshot.getTime() + 70 * 60_000)
  const past = new Date(snapshot.getTime() - 24 * 60 * 60_000)

  let autorunId: number | null = null
  let sessionId: number | null = null

  try {
    await page.goto("/autoruns")
    await expect(page.getByTestId("autoruns-view")).toBeVisible()

    await page.getByTestId("new-autorun-primary").click()
    await page.getByTestId("autorun-name").fill(name)
    await expect(page.getByTestId("autorun-slug")).not.toHaveValue("")

    await page.getByTestId("autorun-next").click()
    await expect(page.getByTestId("autorun-wizard-step")).toContainText("Step 2 of 4")
    await expect(page.getByTestId("autorun-utc-hint")).toHaveText("Your local time — stored as UTC")

    await page.getByTestId("autorun-start").fill(localInput(past))
    await expect(page.getByTestId("autorun-past-warning")).toContainText("backfill trigger")
    await page.getByTestId("autorun-start").fill(localInput(start))
    await page.getByTestId("autorun-end").fill(localInput(end))
    await expect(page.getByTestId("autorun-past-warning")).toHaveCount(0)

    await page.getByTestId("autorun-next").click()
    await page.getByTestId("autorun-engine").selectOption({ label: "yt_dlp_piped" })
    await page.getByTestId("autorun-resolver").selectOption({ label: "static" })
    await page.getByLabel("Url").fill("https://example.com/nonexistent-stream.m3u8")

    await page.getByTestId("autorun-next").click()
    await expect(page.getByTestId("autorun-review")).toContainText(name)

    const createResponse = page.waitForResponse(
      (response) => response.url().includes("/api/autoruns/") && response.request().method() === "POST",
    )
    await page.getByTestId("autorun-submit").click()
    const createdResponse = await createResponse
    const created = (await createdResponse.json()) as { id: number; status: string }
    autorunId = created.id
    expect(created.status).toBe("scheduled")

    const row = page.getByTestId("table-row").filter({ hasText: name })
    await expect(row).toBeVisible()
    await expect(row.getByTestId("status-chip")).toContainText("Scheduled")
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-14-autoruns-scheduled.png"), fullPage: true })

    let spawned: { id: number; status: string } | undefined
    await page.route("**/api/sessions/**", async (route) => {
      if (route.request().method() !== "POST") return route.fallback()
      const response = await route.fetch()
      spawned = (await response.json()) as { id: number; status: string }
      await route.fulfill({ response })
    })
    await page.getByTestId(`autorun-${autorunId}-run-now`).click()
    await expect.poll(() => spawned?.id ?? 0, { timeout: 15_000 }).toBeGreaterThan(0)
    const spawnedId = spawned?.id
    if (spawnedId === undefined) throw new Error("run-now did not spawn a session")
    sessionId = spawnedId
    await expect(page).toHaveURL(new RegExp(`/sessions/${sessionId}$`))

    await expect
      .poll(
        async () => {
          const probe = await api.get(`/api/sessions/${sessionId}`, { headers })
          if (!probe.ok()) return `http-${probe.status()}`
          const body = (await probe.json()) as { status: string }
          return body.status
        },
        { timeout: 90_000, intervals: [1_000, 2_000, 5_000] },
      )
      .toBe("failed")

    const terminal = (await (await api.get(`/api/sessions/${sessionId}`, { headers })).json()) as {
      attempts?: readonly unknown[]
    }
    expect((terminal.attempts ?? []).length).toBeGreaterThan(0)

    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-14-run-now-terminal.png"), fullPage: true })
  } finally {
    if (sessionId !== null) await deleteUntilGone(api, `/api/sessions/${sessionId}`, headers)
    if (autorunId !== null) await deleteUntilGone(api, `/api/autoruns/${autorunId}`, headers)
  }
})

test("stubbed: the 10s tick moves the countdown, live edit is locked with the warning copy, V6 shows the linked session", async ({ page }) => {
  const base = new Date("2031-03-04T10:00:00Z")
  const startIn65s = new Date(base.getTime() + 65_000)
  const live = {
    id: 41,
    user_friendly_name: "Live capture",
    snake_case_name: "live_capture",
    profile_id: null,
    engine_id: 1,
    resolver_id: 1,
    resolver_config: { url: "https://example.com/original.m3u8" },
    retry_mode: "none",
    retry_config: {},
    status: "recording",
    start_time: "2020-01-01T00:00:00",
    end_time: "2031-03-04T12:00:00",
    recording: true,
  }
  const scheduled = {
    ...live,
    id: 43,
    user_friendly_name: "Tick me",
    snake_case_name: "tick_me",
    status: "scheduled",
    start_time: naiveUtc(startIn65s),
    end_time: naiveUtc(new Date(startIn65s.getTime() + 60 * 60_000)),
  }

  await page.clock.install({ time: base })
  await page.route("**/api/autoruns/**", (route) => {
    if (route.request().url().includes("/api/autoruns/41")) return route.fallback()
    return route.fulfill({ json: { items: [live, scheduled], next_cursor: null, has_more: false } })
  })
  await page.route("**/api/autoruns/41", (route) => route.fulfill({ json: live }))
  await page.route("**/api/sessions/**", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 88,
            autorun_id: 41,
            engine_id: 1,
            resolver_id: 1,
            status: "recording",
            recording: true,
            started_at: "2020-01-01T00:00:05",
            attempts: [],
          },
        ],
        next_cursor: null,
        has_more: false,
      },
    }),
  )
  await page.route("**/api/engines/**", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 1,
            name: "yt_dlp_piped",
            capabilities: { can_record: true },
            retry_modes_schema: { none: { default_params: {} } },
          },
        ],
        next_cursor: null,
        has_more: false,
      },
    }),
  )
  await page.route("**/api/resolvers/**", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 1,
            name: "static",
            config_schema: { type: "object", properties: { url: { type: "string", title: "Url" } }, required: ["url"] },
          },
        ],
        next_cursor: null,
        has_more: false,
      },
    }),
  )
  await page.route("**/api/profiles/**", (route) =>
    route.fulfill({ json: { items: [], next_cursor: null, has_more: false } }),
  )

  await page.goto("/autoruns")
  await expect(page.getByTestId("table-row").filter({ hasText: "Live capture" })).toBeVisible()

  const countdown = page.getByTestId("autorun-countdown-43")
  await expect(countdown).toHaveText("starts in ~1 min")
  await page.clock.fastForward(COUNTDOWN_TICK_MS)
  await expect(countdown).toHaveText("starts in ~<1 min")

  await page.getByTestId("autorun-41-edit").click()
  await page.getByTestId("autorun-next").click()
  await expect(page.getByTestId("autorun-live-lock")).toHaveText(
    "This autorun is running — only name and times can change; setting an end time in the past stops the current run",
  )
  await expect(page.getByTestId("autorun-start")).toBeDisabled()
  await expect(page.getByTestId("autorun-end")).toBeEnabled()
  await expect(page.getByTestId("autorun-live-end-warning")).toHaveText(
    "Setting an end time in the past stops the current run",
  )
  await page.getByTestId("autorun-next").click()
  await expect(page.getByTestId("autorun-engine")).toBeDisabled()
  await expect(page.getByTestId("autorun-resolver")).toBeDisabled()
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-14-live-edit-lock.png") })
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click()

  await page.goto("/autoruns/41")
  await expect(page.getByTestId("autorun-live-lock-panel")).toContainText("This autorun is running")
  const linked = page.getByTestId("linked-session-card")
  await expect(linked).toBeVisible()
  await expect(linked).toContainText("Recording")
  await expect(page.getByTestId("linked-session-link")).toHaveAttribute("href", "/sessions/88")
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-14-linked-session.png"), fullPage: true })
})

test("stubbed: spent rows sit at 60% opacity and Save as profile submits the name", async ({ page }) => {
  const spent = {
    id: 42,
    user_friendly_name: "Spent capture",
    snake_case_name: "spent_capture",
    profile_id: null,
    engine_id: 1,
    resolver_id: 1,
    resolver_config: {},
    retry_mode: "none",
    retry_config: {},
    status: "failed",
    start_time: "2020-01-01T00:00:00",
    end_time: "2020-01-01T01:00:00",
    recording: true,
  }

  await page.route("**/api/autoruns/**", (route) =>
    route.fulfill({ json: { items: [spent], next_cursor: null, has_more: false } }),
  )
  await page.route("**/api/autoruns/42/save-as-profile", (route) =>
    route.fulfill({ json: { id: 12, name: "e2e spent profile", default_engine_id: 1, resolver_id: 1 } }),
  )

  await page.goto("/autoruns")
  await expect(page.getByTestId("autoruns-view")).toBeVisible()
  await expect(page.getByTestId("table-row")).toHaveCount(0)

  await page.getByTestId("autorun-filter-spent").click()
  const row = page.getByTestId("table-row").filter({ hasText: "Spent capture" })
  await expect(row).toBeVisible()
  await expect(row).toHaveClass(/opacity-60/)

  const saved = page.waitForRequest(
    (request) => request.url().includes("/api/autoruns/42/save-as-profile") && request.method() === "POST",
  )
  await page.getByTestId("autorun-42-save-as-profile").click()
  await page.getByLabel("Profile name").fill("e2e spent profile")
  await page.getByRole("dialog").getByRole("button", { name: "Save profile" }).click()
  const request = await saved
  expect(request.postDataJSON()).toEqual({ name: "e2e spent profile" })
  await expect(page.getByText('Profile "e2e spent profile" saved')).toBeVisible()
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-14-spent-save-as-profile.png") })
})
