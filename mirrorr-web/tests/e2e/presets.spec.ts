import { engine, expect, profile, resolver, source, test } from "./fixtures"

/**
 * The Presets page (`/profiles`) — one "+" and one dialog for both things the
 * page holds.
 *
 * The two panels used to render their own floating "+", pinned to the same
 * corner: on a touch layout the source one was painted last and won every tap,
 * so a profile could not be created from the phone at all. The page now has a
 * single "+" — the phone's only create entry — opening a dialog with a
 * Profile/Source switcher. On a wide screen each section keeps its own button
 * and the dialog opens scoped to that kind, with no switcher to answer.
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

/** A resolver that declares a catalog — the browse affordance and the drawer. */
const BROWSABLE = resolver({
  id: 1,
  name: "Wide IPTV",
  has_catalog: true,
  search_schema: { type: "object", properties: { category: { type: "string", title: "Category" } } },
  config_schema: { type: "object", properties: { channel: { type: "string", title: "Channel" } } },
})

/** Three items in two pages, so holding the whole catalog means reading twice. */
const CATALOG = [
  { id: "1", title: "Sky Sports Main Event", config: { channel: "premium1" } },
  { id: "2", title: "Sky Sports F1", config: { channel: "premium2" } },
  { id: "3", title: "Eurosport 1", config: { channel: "premium3" } },
]

const MOBILE = { width: 375, height: 812 }

test.describe("presets page", () => {
  test.beforeEach(async ({ api }) => {
    api.data.engines = [
      engine({
        id: 1,
        name: "Streamlink",
        retry_modes_schema: {
          none: { schema: { type: "object", properties: {} }, default_params: {} },
          quick: { schema: { type: "object", properties: { attempts: { type: "integer", title: "Attempts" } } }, default_params: { attempts: 3 } },
        },
      }),
    ]
    api.data.resolvers = [BROWSABLE, resolver({ id: 2, name: "Daddy Live" })]
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

    // An engine declares the retry modes, so that group is inert until one is picked.
    const mode = page.getByRole("combobox", { name: /^Mode/ })
    await expect(mode).toBeDisabled()
    await page.getByRole("combobox", { name: /^Engine/ }).selectOption("1")
    await expect(mode).toBeEnabled()

    // The list is exactly the engine's own schema — the schema's `none` mode is the
    // default, with no second "no retry" option beside it.
    await expect(mode.locator("option")).toHaveText(["None", "Quick"])
    await expect(mode).toHaveValue("none")
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

  test("a section button opens only its own kind", async ({ page }) => {
    await page.goto("/profiles")
    await page.getByRole("button", { name: "New source" }).first().click()

    await expect(page.getByRole("dialog", { name: "New source" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Create source" })).toBeVisible()
    // One action per section out here: nothing to choose, so no switcher.
    await expect(page.getByRole("tab")).toHaveCount(0)
  })

  test("editing locks the dialog to the kind being edited", async ({ page }) => {
    await page.goto("/profiles")
    await page.getByRole("button", { name: "Edit profile F1 Weekend" }).first().click()

    await expect(page.getByRole("dialog", { name: "Edit profile" })).toBeVisible()
    await expect(page.getByRole("tab", { name: "Source", exact: true })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible()
  })

  test("the browser reads the catalog once and filters what it holds", async ({ page, api }) => {
    api.data.discovery = CATALOG
    api.data.discoveryPageSize = 2
    await page.goto("/profiles")
    await page.getByRole("button", { name: "New profile" }).first().click()
    await page.getByRole("combobox", { name: /^Resolver/ }).selectOption("1")

    await page.getByRole("button", { name: "Browse Wide IPTV…" }).click()

    const drawer = page.getByRole("dialog", { name: "Browse Wide IPTV" })
    await expect(drawer).toBeVisible()
    // Every page is read in the background: the whole catalog ends up held here.
    await expect(drawer.getByText("Eurosport 1")).toBeVisible()
    expect(api.callsTo("/discover")).toHaveLength(2)

    // Typing narrows what is already held — no request, so nothing waits on the
    // network while the words are being typed.
    await drawer.getByLabel("Search the catalog").fill("euro")
    await expect(drawer.getByText("Eurosport 1")).toBeVisible()
    await expect(drawer.getByText("Sky Sports Main Event")).toHaveCount(0)
    expect(api.callsTo("/discover")).toHaveLength(2)
  })

  test("the profile form's browser fills the resolver config", async ({ page, api }) => {
    api.data.discovery = CATALOG
    await page.goto("/profiles")
    await page.getByRole("button", { name: "New profile" }).first().click()
    await page.getByRole("combobox", { name: /^Resolver/ }).selectOption("1")

    await page.getByRole("button", { name: "Browse Wide IPTV…" }).click()
    await page.getByRole("dialog", { name: "Browse Wide IPTV" }).getByRole("button", { name: "Use" }).first().click()

    // The drawer closes and the item's own config lands in the form.
    await expect(page.getByRole("dialog", { name: "Browse Wide IPTV" })).toBeHidden()
    await expect(page.getByLabel("Channel")).toHaveValue("premium1")

    await page.getByLabel("Name").fill("Sky copy")
    await page.getByRole("combobox", { name: /^Engine/ }).selectOption("1")
    await page.getByRole("button", { name: "Create profile" }).click()

    const created = api.callsTo("/profiles/").filter((call) => call.method === "POST")
    expect(created).toHaveLength(1)
    expect(created[0]?.body).toMatchObject({
      name: "Sky copy",
      resolver_id: 1,
      resolver_config: { channel: "premium1" },
    })
  })
})
