import { expect, session, test, type Row } from "./fixtures"

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

/** The shared card skeleton — one `EntityCard` per recording. */
const CARD = '[data-slot="entity-card"]'

/** Selection is a mode now: no checkbox exists on a card at rest. */
async function enterSelectMode(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "Select", exact: true }).click()
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
    await expect(page.locator(CARD)).toHaveCount(3)

    await enterSelectMode(page)
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
    await enterSelectMode(page)
    const card = page.locator('[data-id="2"] [data-slot="entity-card"]')
    const box = page.getByRole("checkbox", { name: "Select Qualifying" })

    await box.check()
    await expect(card).toHaveAttribute("data-selected", "true")

    await box.uncheck()
    await expect(card).not.toHaveAttribute("data-selected", "true")
    await expect(page.getByRole("region", { name: "Bulk actions" })).toBeHidden()
  })

  test("a phone keeps the bulk bar above the bottom nav", async ({ page }) => {
    await page.setViewportSize({ width: 402, height: 874 })
    await page.goto("/recordings")
    await enterSelectMode(page)
    await page.getByRole("checkbox", { name: "Select Qualifying" }).check()

    const bar = page.getByRole("region", { name: "Bulk actions" })
    const nav = page.getByRole("navigation", { name: "Primary" })
    await expect(bar).toBeVisible()

    // Polled: the bar and the FAB spring into place, so a one-shot box
    // comparison is a race (measured flake ~1.6 px when the whole suite runs
    // in parallel). The invariant is the settled gap, not the first frame.
    await expect
      .poll(
        async () => {
          const barBox = await bar.boundingBox()
          const navBox = await nav.boundingBox()
          if (barBox === null || navBox === null) return Number.POSITIVE_INFINITY
          return Math.round((barBox.y + barBox.height - navBox.y) * 10) / 10
        },
        { message: "the bulk bar must end at or above the bottom nav" },
      )
      .toBeLessThanOrEqual(0)
  })

  test("a phone takes every recording from the head above the grid", async ({ page }) => {
    await page.setViewportSize({ width: 402, height: 874 })
    await page.goto("/recordings")
    await enterSelectMode(page)

    const head = page.getByRole("checkbox", { name: "Select all recordings" })
    await expect(head).toBeInViewport()

    await head.check()
    await expect(page.getByRole("region", { name: "Bulk actions" })).toContainText("3 selected items")

    await head.uncheck()
    await expect(page.getByRole("region", { name: "Bulk actions" })).toBeHidden()
  })

  test("the storage line adds up the whole library", async ({ page }) => {
    await page.goto("/recordings")

    const strip = page.getByTestId("storage-strip")
    // Three one-hour, 900 MB cards: 2.7 GB of bytes and three hours of video.
    await expect(strip).toContainText("3 recordings · 2.5 GB · 3:00:00")
    await expect(strip).toContainText("free of")
  })

  test("the order control sorts the loaded cards, newest by default", async ({ page }) => {
    await page.goto("/recordings")
    const cards = page.locator(CARD)
    await expect(cards.first()).toContainText("The Race")

    await page.getByLabel("Sort recordings").selectOption("largest")
    await expect(cards.first()).toContainText("The Race")
    await expect(cards.last()).toContainText("Practice 1")

    await page.getByLabel("Sort recordings").selectOption("longest")
    await expect(cards.first()).toContainText("The Race")
  })

  test("a card links to the session that made it", async ({ page, api }) => {
    api.data.recordings = [recording({ id: 1, session_id: 42 })]
    api.data.sessions = [session({ id: 42 })]

    await page.goto("/recordings")

    await page.getByRole("link", { name: "Session #42" }).click()
    await expect(page).toHaveURL(/\/sessions\/42$/)
  })

  test("the search reaches a recording no page has loaded yet", async ({ page, api }) => {
    api.data.pageSize = 2

    await page.goto("/recordings")
    await expect(page.locator(CARD)).toHaveCount(2)
    await expect(page.locator('[data-slot="card-grid"]')).not.toContainText("The Race")

    // The term goes to the server, so the third card is found without paging.
    await page.getByLabel("Search recordings").fill("race")

    await expect(page.locator(CARD)).toHaveCount(1)
    await expect(page.locator(CARD)).toContainText("The Race")
  })

  test("a term nobody matches offers a way back", async ({ page }) => {
    await page.goto("/recordings")
    await page.getByLabel("Search recordings").fill("nothing-like-this")

    await expect(page.getByText("No recording matches \u201cnothing-like-this\u201d.")).toBeVisible()
    await page.getByRole("button", { name: "Clear search" }).click()
    await expect(page.locator(CARD)).toHaveCount(3)
  })
})
