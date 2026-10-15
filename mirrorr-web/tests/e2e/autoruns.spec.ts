import { autorun, expect, profile, test } from "./fixtures"

/**
 * `next_run_at` is deliberately out of id order so "soonest first" cannot pass
 * by accident, and one row is `completed` so the Upcoming filter has something
 * to hide.
 */
const ZULU = autorun({
  id: 1,
  user_friendly_name: "Zulu",
  snake_case_name: "zulu",
  next_run_at: "2026-10-20 09:00:00",
})
const ALPHA = autorun({
  id: 2,
  user_friendly_name: "Alpha",
  snake_case_name: "alpha",
  next_run_at: "2026-10-12 09:00:00",
})
const MIKE = autorun({
  id: 3,
  user_friendly_name: "Mike",
  snake_case_name: "mike",
  next_run_at: "2026-10-16 09:00:00",
})
const SPENT = autorun({
  id: 4,
  user_friendly_name: "Done",
  snake_case_name: "done",
  status: "completed",
})

test.describe("scheduled recordings", () => {
  test.beforeEach(async ({ api }) => {
    api.data.autoruns = [ZULU, ALPHA, MIKE, SPENT]
    api.data.profiles = [
      profile({ id: 1, name: "F1 Weekend" }),
      profile({ id: 2, name: "News Hour" }),
    ]
  })

  test("orders the cards soonest first, spent ones included by default", async ({ page }) => {
    await page.goto("/autoruns")

    // Cards at desktop width too — the table variant is gone for good.
    await expect(page.locator("table")).toHaveCount(0)

    const cards = page.locator(".entity-card")
    await expect(cards).toHaveCount(4)
    await expect(cards.nth(0)).toContainText("Alpha")
    await expect(cards.nth(3)).toContainText("Zulu")
    await expect(page.getByRole("link", { name: "Done" })).toBeVisible()
  })

  test("the Upcoming filter hides the completed recording again", async ({ page }) => {
    await page.goto("/autoruns")
    await expect(page.locator(".entity-card")).toHaveCount(4)

    await page.getByRole("button", { name: "Upcoming" }).click()

    await expect(page.locator(".entity-card")).toHaveCount(3)
    await expect(page.getByRole("link", { name: "Done" })).toHaveCount(0)
  })

  test("keeps the card layout at both phone and desktop widths", async ({ page }) => {
    await page.goto("/autoruns")

    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 800 })

      await expect(page.locator("table"), `no table at ${width}px`).toHaveCount(0)

      const cards = page.locator(".entity-card")
      await expect(cards).toHaveCount(4)
      await expect(cards.nth(0)).toContainText("Alpha")
      await expect(cards.nth(3)).toContainText("Zulu")
    }
  })

  test("sets one profile across the whole selection", async ({ page, api }) => {
    await page.goto("/autoruns")

    await page.getByLabel("Select all scheduled recordings").check()

    const bulk = page.getByRole("region", { name: "Bulk actions" })
    await expect(bulk).toContainText("4 selected items")

    await bulk.getByRole("button", { name: "Set profile" }).click()
    const dialog = page.getByRole("dialog")
    await expect(
      dialog.getByRole("heading", { name: "Set the profile on 4 scheduled recordings" }),
    ).toBeVisible()

    await dialog.getByLabel("Profile").selectOption("2")
    await dialog.getByRole("button", { name: "Set profile" }).click()

    await expect(page.getByText("Profile set")).toBeVisible()

    const puts = api.callsTo("/autoruns/").filter((call) => call.method === "PUT")
    expect(puts.map((call) => call.path).sort()).toEqual([
      "/autoruns/1",
      "/autoruns/2",
      "/autoruns/3",
      "/autoruns/4",
    ])
    for (const call of puts) expect(call.body).toEqual({ profile_id: 2 })
  })
})
