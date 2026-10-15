import { engine, expect, profile, resolver, source, test } from "./fixtures"

/**
 * The Presets page (`/profiles`) — one "+" and one dialog for both things the
 * page holds.
 *
 * The two panels used to render their own floating "+", pinned to the same
 * corner: on a touch layout the source one was painted last and won every tap,
 * so a profile could not be created from the phone at all. The page now has a
 * single "+" opening a dialog with a Profile/Source switcher, and the desktop
 * section buttons open that same dialog on their own tab.
 *
 * Inside the profile form the resolver config has two possible origins — a
 * chosen resolver or a copied saved source — which used to be two live pickers
 * overwriting each other. Exactly one mode's controls are rendered now.
 */

const SKY = source({
  id: 9,
  name: "Sky Sports",
  resolver_id: 2,
  resolver_name: "Daddy Live",
  resolver_config: { url: "http://sky.example/playlist.m3u8", quality: "720p" },
})

const MOBILE = { width: 375, height: 812 }

test.describe("presets page", () => {
  test.beforeEach(async ({ api }) => {
    api.data.engines = [engine({ id: 1, name: "Streamlink" })]
    api.data.resolvers = [resolver({ id: 1, name: "Wide IPTV" }), resolver({ id: 2, name: "Daddy Live" })]
    api.data.profiles = [profile({ id: 1, name: "F1 Weekend" })]
    api.data.sources = [SKY]
  })

  test("the page has exactly one + and it opens on the profile tab", async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await page.goto("/profiles")

    const fab = page.locator("[data-slot=fab]")
    await expect(fab).toHaveCount(1)
    await expect(fab).toHaveAccessibleName("New preset")

    await fab.click()

    await expect(page.getByRole("dialog", { name: "New preset" })).toBeVisible()
    await expect(page.getByRole("tab", { name: "Profile", exact: true })).toHaveAttribute("aria-selected", "true")
    await expect(page.getByRole("combobox", { name: /^Engine/ })).toBeVisible()
    await expect(page.getByRole("button", { name: "Create profile" })).toBeDisabled()
  })

  test("the + panel can create a source without leaving the dialog", async ({ page, api }) => {
    await page.setViewportSize(MOBILE)
    await page.goto("/profiles")
    await page.locator("[data-slot=fab]").click()

    await page.getByRole("tab", { name: "Source", exact: true }).click()

    await expect(page.getByRole("button", { name: "Create source" })).toBeVisible()
    await expect(page.getByRole("combobox", { name: /^Engine/ })).toHaveCount(0)

    await page.getByLabel("Name").fill("Sky backup")
    await page.getByRole("combobox", { name: /^Resolver/ }).selectOption("1")
    await page.getByRole("button", { name: "Create source" }).click()

    const created = api.callsTo("/sources/").filter((call) => call.method === "POST")
    expect(created).toHaveLength(1)
    expect(created[0]?.body).toMatchObject({ name: "Sky backup", resolver_id: 1 })
  })

  test("the profile form swaps between resolver and saved source, never both", async ({ page, api }) => {
    await page.goto("/profiles")
    await page.getByRole("button", { name: "New profile" }).first().click()

    // Default mode: the resolver picker is the only origin on screen.
    await expect(page.getByRole("tab", { name: "Pick a resolver" })).toHaveAttribute("aria-selected", "true")
    await expect(page.getByRole("combobox", { name: /^Resolver/ })).toBeVisible()
    await expect(page.getByRole("combobox", { name: /^Saved source/ })).toHaveCount(0)

    await page.getByRole("tab", { name: "Use a saved source" }).click()

    await expect(page.getByRole("combobox", { name: /^Resolver/ })).toHaveCount(0)
    const picked = page.getByRole("combobox", { name: /^Saved source/ })
    await picked.selectOption("9")

    // The copy is shown, so it is clear what the profile will save.
    await expect(page.getByText("The profile keeps its own copy")).toBeVisible()

    await page.getByLabel("Name").fill("Sky copy")
    await page.getByRole("combobox", { name: /^Engine/ }).selectOption("1")
    await page.getByRole("button", { name: "Create profile" }).click()

    const created = api.callsTo("/profiles/").filter((call) => call.method === "POST")
    expect(created).toHaveLength(1)
    expect(created[0]?.body).toMatchObject({
      name: "Sky copy",
      default_engine_id: 1,
      resolver_id: 2, // the saved source's resolver, not the one in the picker
      resolver_config: { url: "http://sky.example/playlist.m3u8", quality: "720p" },
    })
  })

  test("a section button opens the dialog on its own tab", async ({ page }) => {
    await page.goto("/profiles")
    await page.getByRole("button", { name: "New source" }).first().click()

    await expect(page.getByRole("dialog", { name: "New preset" })).toBeVisible()
    await expect(page.getByRole("tab", { name: "Source", exact: true })).toHaveAttribute("aria-selected", "true")
  })

  test("editing locks the dialog to the kind being edited", async ({ page }) => {
    await page.goto("/profiles")
    await page.getByRole("button", { name: "Edit profile F1 Weekend" }).first().click()

    await expect(page.getByRole("dialog", { name: "Edit profile" })).toBeVisible()
    await expect(page.getByRole("tab", { name: "Source", exact: true })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible()
  })
})
