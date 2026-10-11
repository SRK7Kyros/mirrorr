import { autorun, expect, profile, test } from "./fixtures"

/**
 * `next_run_at` is deliberately out of id order so "soonest first" cannot pass
 * by accident, and one row is `completed` so the default Upcoming filter has
 * something to hide.
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

  test("orders the table soonest first and hides spent rows by default", async ({ page }) => {
    await page.goto("/autoruns")

    await expect(page.locator(".table-desktop")).toBeVisible()
    await expect(page.locator(".cards-mobile")).toBeHidden()

    const rows = page.locator(".table-desktop tbody tr")
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(0)).toContainText("Alpha")
    await expect(rows.nth(1)).toContainText("Mike")
    await expect(rows.nth(2)).toContainText("Zulu")
  })

  test("the All filter reveals the completed recording", async ({ page }) => {
    await page.goto("/autoruns")
    await expect(page.locator(".table-desktop tbody tr")).toHaveCount(3)

    await page.getByRole("button", { name: "All" }).click()

    await expect(page.locator(".table-desktop tbody tr")).toHaveCount(4)
    await expect(page.locator(".table-desktop tbody")).toContainText("Done")
  })

  test("swaps the table for cards at a phone width, keeping the order", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 720 })

    await page.goto("/autoruns")

    await expect(page.locator(".table-desktop")).toBeHidden()
    await expect(page.locator(".cards-mobile")).toBeVisible()

    const cards = page.locator(".cards-mobile .entity-card")
    await expect(cards).toHaveCount(3)
    await expect(cards.nth(0)).toContainText("Alpha")
    await expect(cards.nth(2)).toContainText("Zulu")
  })

  test("sets one profile across the whole selection", async ({ page, api }) => {
    await page.goto("/autoruns")

    await page.locator(".table-desktop").getByLabel("Select all scheduled recordings").check()

    const bulk = page.getByRole("region", { name: "Bulk actions" })
    await expect(bulk).toContainText("3 selected items")

    await bulk.getByRole("button", { name: "Set profile" }).click()
    const dialog = page.getByRole("dialog")
    await expect(
      dialog.getByRole("heading", { name: "Set the profile on 3 scheduled recordings" }),
    ).toBeVisible()

    await dialog.getByLabel("Profile").selectOption("2")
    await dialog.getByRole("button", { name: "Set profile" }).click()

    await expect(page.getByText("Profile set")).toBeVisible()

    const puts = api.callsTo("/autoruns/").filter((call) => call.method === "PUT")
    expect(puts.map((call) => call.path).sort()).toEqual([
      "/autoruns/1",
      "/autoruns/2",
      "/autoruns/3",
    ])
    for (const call of puts) expect(call.body).toEqual({ profile_id: 2 })
  })
})
