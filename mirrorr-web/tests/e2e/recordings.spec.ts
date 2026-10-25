import { expect, test, type Row } from "./fixtures"

function recording(overrides: Row = {}): Row {
  return {
    id: 1,
    user_friendly_name: "Practice 1",
    snake_case_name: "practice_1",
    content_url: "https://mirrorr.example/content/1/recording.mp4",
    profile_name: "F1 Weekend",
    engine_name: "Streamlink",
    resolver_name: "Wide IPTV",
    started_at: "2026-10-12 09:00:00",
    ended_at: "2026-10-12 10:00:00",
    duration_seconds: 3600,
    size_bytes: 900_000_000,
    created_at: "2026-10-12 10:00:05",
    media_served: false,
    ...overrides,
  }
}

test.describe("recordings", () => {
  test.beforeEach(async ({ api }) => {
    api.data.recordings = [
      recording({ id: 1, user_friendly_name: "Practice 1", snake_case_name: "practice_1" }),
      recording({ id: 2, user_friendly_name: "Qualifying", snake_case_name: "qualifying" }),
      recording({ id: 3, user_friendly_name: "The Race", snake_case_name: "the_race" }),
    ]
  })

  test("selects cards and deletes the whole selection at once", async ({ page, api }) => {
    await page.goto("/recordings")
    await expect(page.locator(".session-card")).toHaveCount(3)

    await page.getByRole("checkbox", { name: "Select Practice 1" }).check()
    await page.getByRole("checkbox", { name: "Select The Race" }).check()

    const bulk = page.getByRole("region", { name: "Bulk actions" })
    await expect(bulk).toContainText("2 selected items")

    await bulk.getByRole("button", { name: "Delete selected" }).click()
    const confirm = page.getByRole("dialog", { name: "Delete 2 recordings?" })
    await expect(confirm).toBeVisible()
    await confirm.getByRole("button", { name: "Delete" }).click()

    await expect(page.getByText("Recordings deleted")).toBeVisible()

    const deletes = api.callsTo("/recordings/").filter((call) => call.method === "DELETE")
    expect(deletes.map((call) => call.path).sort()).toEqual(["/recordings/1", "/recordings/3"])
  })

  test("a card clears its selection when it is picked again", async ({ page }) => {
    await page.goto("/recordings")
    const card = page.locator('.session-card[data-id="2"]')
    const box = page.getByRole("checkbox", { name: "Select Qualifying" })

    await box.check()
    await expect(card).toHaveAttribute("data-selected", "true")

    await box.uncheck()
    await expect(card).toHaveAttribute("data-selected", "false")
    await expect(page.getByRole("region", { name: "Bulk actions" })).toBeHidden()
  })

  test("a phone keeps the bulk bar above the bottom nav", async ({ page }) => {
    await page.setViewportSize({ width: 402, height: 874 })
    await page.goto("/recordings")
    await page.getByRole("checkbox", { name: "Select Qualifying" }).check()

    const bar = page.getByRole("region", { name: "Bulk actions" })
    const nav = page.getByRole("navigation", { name: "Primary" })
    await expect(bar).toBeVisible()

    const barBox = await bar.boundingBox()
    const navBox = await nav.boundingBox()
    if (barBox === null || navBox === null) throw new Error("the bulk bar or the nav is not laid out")
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(navBox.y - 4)
  })
})
