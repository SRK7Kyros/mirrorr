import type { Locator } from "@playwright/test"
import { expect, session, test } from "./fixtures"

/**
 * The sessions list is a card grid at every width, so these specs cover the
 * tally, the client-side status filter and the search box rather than a
 * table/card swap.
 */
const LIVE = session({
  id: 1,
  status: "active",
  started_at: "2026-10-11 08:00:00",
  profile_name: "F1 Weekend",
})
const RECORDING = session({
  id: 2,
  status: "recording",
  recording: true,
  started_at: "2026-10-11 08:30:00",
  profile_name: "F1 Weekend",
})
const SCHEDULED = session({ id: 3, status: "scheduled", profile_name: "News Hour" })
const SPENT = session({
  id: 4,
  status: "completed",
  started_at: "2026-10-10 08:00:00",
  ended_at: "2026-10-10 10:00:00",
  profile_name: "Archive",
})
const STARTING = session({
  id: 5,
  status: "stream_pending",
  session_urls: [{ label: "M3U8", url: "https://example.test/stream.m3u8" }],
})
const FAILED = session({
  id: 6,
  status: "failed",
  started_at: "2026-10-10 08:00:00",
  ended_at: "2026-10-10 08:02:00",
  profile_name: "Archive",
})

/** One `Stat` inside the ops strip — its label's cell, so a value is unambiguous. */
const stat = (strip: Locator, label: string): Locator =>
  strip.getByText(label, { exact: true }).locator("..")

/** A naive-UTC stamp `offsetMs` from now, the shape the server sends. */
const naiveUtc = (offsetMs: number): string =>
  new Date(Date.now() + offsetMs).toISOString().slice(0, 19).replace("T", " ")

test.describe("sessions list", () => {
  test.beforeEach(async ({ api }) => {
    api.data.sessions = [LIVE, RECORDING, SCHEDULED, SPENT]
  })

  test("cards every loaded session under the default all view", async ({ page }) => {
    await page.goto("/sessions")

    await expect(page.getByRole("heading", { level: 1, name: "Sessions" })).toBeVisible()
    // The default view is `all`, so the completed session is carded too.
    await expect(page.locator(".session-grid .session-card")).toHaveCount(4)
  })

  test("the ops strip counts the account, not only the page in hand", async ({ page, api }) => {
    api.data.sessions = [LIVE, RECORDING, STARTING, SCHEDULED, SPENT, FAILED]
    api.data.nextAutorun = {
      id: 7,
      name: "mexico_gp_race",
      starts_at: naiveUtc(2 * 3600 * 1000),
      status: "scheduled",
    }
    // Danger territory: the core refuses a capture below 2 GB free.
    api.data.disk = { total_bytes: 200 * 1024 ** 3, free_bytes: 1024 ** 3 }

    await page.goto("/sessions")

    const strip = page.getByTestId("ops-strip")
    await expect(strip).toContainText("6 sessions in account")
    await expect(stat(strip, "Live")).toContainText("2")
    await expect(stat(strip, "Live")).toContainText("1 starting")
    await expect(stat(strip, "Failed in 24 h")).toContainText("1")
    await expect(stat(strip, "Disk free")).toContainText("1.0 GB")
    await expect(stat(strip, "Disk free")).toContainText("200.0 GB total")
    await expect(stat(strip, "Next schedule")).toContainText("mexico_gp_race")
    await expect(stat(strip, "Next schedule")).toContainText("starts in ~2 h")
  })

  test("the strip says so when nothing is pending", async ({ page, api }) => {
    api.data.sessions = [SPENT]
    api.data.disk = null

    await page.goto("/sessions")

    const strip = page.getByTestId("ops-strip")
    await expect(stat(strip, "Next schedule")).toContainText("none pending")
    await expect(stat(strip, "Disk free")).toContainText("—")
  })

  test("the status tokens are additive, and dropping one widens the set again", async ({ page }) => {
    await page.goto("/sessions")
    await expect(page.locator(".session-grid .session-card")).toHaveCount(4)

    await expect(page.getByRole("button", { name: "Scheduled" })).toHaveCount(0)

    // Naming any status drops `all`, so Spent alone leaves the completed run.
    await page.getByRole("button", { name: "Spent" }).click()
    await expect(page.locator(".session-grid .session-card")).toHaveCount(1)
    await expect(page.locator(".session-grid")).toContainText("Archive")

    // Adding Live widens the set to live + spent; the tokens are additive.
    await page.getByRole("button", { name: "Live" }).click()
    await expect(page.locator(".session-grid .session-card")).toHaveCount(3)

    // Dropping Spent again leaves the two live runs.
    await page.getByRole("button", { name: "Spent" }).click()
    await expect(page.locator(".session-grid .session-card")).toHaveCount(2)
  })

  test("the search box narrows the cards", async ({ page }) => {
    await page.goto("/sessions")
    await expect(page.locator(".session-grid .session-card")).toHaveCount(4)

    await page.getByLabel("Filter sessions").fill("news")

    await expect(page.locator(".session-grid .session-card")).toHaveCount(1)
    await expect(page.locator(".session-grid")).toContainText("News Hour")
  })

  test("the search reaches a session no page has loaded yet", async ({ page, api }) => {
    api.data.pageSize = 2
    api.data.sessions = [LIVE, RECORDING, SCHEDULED, SPENT]

    await page.goto("/sessions")
    await expect(page.locator(".session-grid .session-card")).toHaveCount(2)
    await expect(page.locator(".session-grid")).not.toContainText("Archive")

    // The term goes to the server, so the fourth row is found without paging.
    await page.getByLabel("Filter sessions").fill("archive")

    await expect(page.locator(".session-grid .session-card")).toHaveCount(1)
    await expect(page.locator(".session-grid")).toContainText("Archive")
  })

  test("a term nobody matches says so instead of claiming the list is empty", async ({
    page,
  }) => {
    await page.goto("/sessions")
    await page.getByLabel("Filter sessions").fill("nothing-like-this")

    await expect(page.getByText("No session matches “nothing-like-this”.")).toBeVisible()
    await page.getByRole("button", { name: "Clear search" }).first().click()
    await expect(page.locator(".session-grid .session-card")).toHaveCount(4)
  })

  test("the grid still renders at a phone width", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 720 })

    await page.goto("/sessions")

    await expect(page.locator(".session-grid .session-card")).toHaveCount(4)
  })

  test("a starting card shows the loading affordance and mounts no player", async ({ page, api }) => {
    api.data.sessions = [STARTING]

    await page.goto("/sessions")

    await expect(page.locator(".session-grid .session-card")).toHaveCount(1)
    await expect(page.locator('.session-card [data-slot="session-starting"]')).toBeVisible()
    await expect(page.locator(".session-card video")).toHaveCount(0)
    await expect(page.locator(".session-card iframe")).toHaveCount(0)
  })

  test("the live filter keeps the starting states", async ({ page, api }) => {
    api.data.sessions = [LIVE, STARTING, SCHEDULED, SPENT]

    await page.goto("/sessions")
    await expect(page.locator(".session-grid .session-card")).toHaveCount(4)

    await page.getByRole("button", { name: "Live" }).click()
    await expect(page.locator(".session-grid .session-card")).toHaveCount(2)
  })

  test("a starting session's detail panel mounts no player", async ({ page, api }) => {
    api.data.sessions = [
      session({
        id: 5,
        status: "initializing",
        session_urls: [{ label: "M3U8", url: "https://example.test/stream.m3u8" }],
      }),
    ]

    await page.goto("/sessions/5")

    await expect(page.locator('[data-slot="session-starting"]')).toBeVisible()
    await expect(page.locator("video")).toHaveCount(0)
    await expect(page.locator("iframe")).toHaveCount(0)
  })
})
