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

test.describe("sessions list", () => {
  test.beforeEach(async ({ api }) => {
    api.data.sessions = [LIVE, RECORDING, SCHEDULED, SPENT]
  })

  test("counts every loaded session but only cards the default filter's statuses", async ({ page }) => {
    await page.goto("/sessions")

    await expect(page.getByRole("heading", { level: 1, name: "Sessions" })).toBeVisible()
    // Default filter is `scheduled+live`, so the completed session is excluded.
    await expect(page.locator(".session-grid .session-card")).toHaveCount(3)
    await expect(page.getByText("3 sessions")).toBeVisible()
    await expect(page.getByText("over 4 loaded")).toBeVisible()
  })

  test("narrowing the status filter down to Spent leaves the completed session", async ({ page }) => {
    await page.goto("/sessions")
    await expect(page.locator(".session-grid .session-card")).toHaveCount(3)

    // The tokens are additive, so Spent has to be added and the other two dropped.
    await page.getByRole("button", { name: "Spent" }).click()
    await expect(page.locator(".session-grid .session-card")).toHaveCount(4)
    await page.getByRole("button", { name: "Scheduled" }).click()
    await page.getByRole("button", { name: "Live" }).click()

    await expect(page.locator(".session-grid .session-card")).toHaveCount(1)
    await expect(page.locator(".session-grid")).toContainText("Archive")
  })

  test("the search box narrows the cards", async ({ page }) => {
    await page.goto("/sessions")
    await expect(page.locator(".session-grid .session-card")).toHaveCount(3)

    await page.getByLabel("Filter sessions").fill("news")

    await expect(page.locator(".session-grid .session-card")).toHaveCount(1)
    await expect(page.locator(".session-grid")).toContainText("News Hour")
  })

  test("the grid still renders at a phone width", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 720 })

    await page.goto("/sessions")

    await expect(page.locator(".session-grid .session-card")).toHaveCount(3)
  })
})
