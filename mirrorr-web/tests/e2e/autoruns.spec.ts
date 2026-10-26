import { autorun, engine, expect, profile, resolver, test } from "./fixtures"

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
const ORPHANED = autorun({
  id: 5,
  user_friendly_name: "Orphaned",
  snake_case_name: "orphaned",
  next_run_at: "2026-10-18 09:00:00",
  issue: "profile-deleted",
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
    for (const call of puts) expect(call.body).toEqual({ profile_id: 2, fallback_chain: [] })
  })

  test("each row takes the picked profile's chain, not the one it carried", async ({
    page,
    api,
  }) => {
    api.data.profiles = [
      profile({ id: 1, name: "F1 Weekend", resolver_id: 1, resolver_name: "Direct" }),
      profile({
        id: 2,
        name: "News Hour",
        resolver_id: 2,
        resolver_name: "Wide IPTV",
        fallback_chain: [{ resolver_id: 3, resolver_config: {} }],
      }),
    ]
    api.data.resolvers = [
      resolver({ id: 1, name: "Direct" }),
      resolver({ id: 2, name: "Wide IPTV" }),
      resolver({ id: 3, name: "Backup" }),
    ]
    api.data.engines = [engine({ id: 1, name: "Streamlink" })]
    api.data.autoruns = [
      autorun({
        id: 1,
        user_friendly_name: "Zulu",
        snake_case_name: "zulu",
        fallback_chain: [{ profile_id: 1 }],
      }),
      autorun({
        id: 2,
        user_friendly_name: "Alpha",
        snake_case_name: "alpha",
        fallback_chain: [{ resolver_id: 1, resolver_config: {} }],
      }),
      autorun({ id: 3, user_friendly_name: "Mike", snake_case_name: "mike" }),
    ]
    await page.goto("/autoruns")

    await page.getByLabel("Select all scheduled recordings").check()
    await page
      .getByRole("region", { name: "Bulk actions" })
      .getByRole("button", { name: "Set profile" })
      .click()
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("Profile").selectOption("2")

    const chain = dialog.getByRole("list", { name: "Fallback chain, in order" })
    await expect(chain.getByRole("listitem")).toHaveCount(1)

    await dialog.getByRole("button", { name: "Set profile" }).click()
    await expect(page.getByText("Profile set")).toBeVisible()

    const puts = api.callsTo("/autoruns/").filter((call) => call.method === "PUT")
    expect(puts).toHaveLength(3)
    for (const call of puts) {
      expect(call.body).toEqual({
        profile_id: 2,
        fallback_chain: [{ resolver_id: 3, resolver_config: {} }],
      })
    }
  })

  test("the bulk profile carries an editable chain of fallback sources", async ({ page, api }) => {
    api.data.profiles = [
      profile({ id: 1, name: "F1 Weekend" }),
      profile({
        id: 2,
        name: "News Hour",
        fallback_sources: [{ resolver_id: 2, resolver_config: {} }],
      }),
    ]
    api.data.resolvers = [
      resolver({ id: 1, name: "Direct" }),
      resolver({ id: 2, name: "Wide IPTV" }),
      resolver({ id: 3, name: "Backup" }),
    ]
    api.data.engines = [engine({ id: 1, name: "Streamlink" })]
    await page.goto("/autoruns")

    await page.getByLabel("Select all scheduled recordings").check()
    await page
      .getByRole("region", { name: "Bulk actions" })
      .getByRole("button", { name: "Set profile" })
      .click()

    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("Profile").selectOption("2")

    // The profile's own chain is the starting point — setting a profile must not
    // silently drop the sources it would fall back to.
    const chain = dialog.getByRole("list", { name: "Fallback chain, in order" })
    await expect(chain.getByRole("listitem")).toHaveCount(1)

    // …and one action can extend it across the whole selection.
    await dialog.getByRole("combobox", { name: "Fallback 2 · Source" }).selectOption("3")
    await dialog.getByRole("button", { name: "Add fallback" }).click()
    await expect(chain.getByRole("listitem")).toHaveCount(2)

    await dialog.getByRole("button", { name: "Set profile" }).click()
    await expect(page.getByText("Profile set")).toBeVisible()

    const puts = api.callsTo("/autoruns/").filter((call) => call.method === "PUT")
    expect(puts).toHaveLength(4)
    for (const call of puts) {
      expect(call.body).toEqual({
        profile_id: 2,
        fallback_chain: [
          { resolver_id: 2, resolver_config: {} },
          { resolver_id: 3, resolver_config: {} },
        ],
      })
    }
  })

  test("a schedule whose profile was deleted says so instead of vanishing", async ({ page, api }) => {
    api.data.autoruns = [ALPHA, ORPHANED]
    await page.goto("/autoruns")

    const flagged = page.locator(".entity-card[data-issue=profile-deleted]")
    await expect(flagged).toHaveCount(1)
    await expect(flagged).toContainText("Its profile was deleted, so it will not run")
    await expect(page.locator(".entity-card[data-issue]", { hasText: "Alpha" })).toHaveCount(0)

    await flagged.getByRole("link", { name: "Orphaned" }).click()

    const banner = page.locator("[role=status]", { hasText: "Its profile was deleted, so it will not run" })
    await expect(banner).toBeVisible()
    await expect(banner).toContainText("nothing starts it until you pick a profile again")

    await banner.getByRole("button", { name: "Edit" }).click()
    await expect(page.getByRole("dialog", { name: "Edit scheduled recording" })).toBeVisible()
  })

  test("a phone keeps the bulk bar clear of the bottom nav", async ({ page }) => {
    await page.setViewportSize({ width: 402, height: 874 })
    await page.goto("/autoruns")
    await page.getByLabel("Select all scheduled recordings").check()

    const bar = page.getByRole("region", { name: "Bulk actions" })
    const nav = page.getByRole("navigation", { name: "Primary" })
    await expect(bar).toBeVisible()
    await expect(nav).toBeVisible()
    await page.mouse.wheel(0, 600)

    const barBox = await bar.boundingBox()
    const navBox = await nav.boundingBox()
    if (barBox === null || navBox === null) throw new Error("the bulk bar or the nav is not laid out")
    // The bar floats level with the + button, so it clears the nav's own pill
    // rather than the space the nav reserves below it.
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(navBox.y)
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(874)
  })
})
