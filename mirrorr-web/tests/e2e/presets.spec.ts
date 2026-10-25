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

    await expect.poll(() => api.callsTo("/profiles/").filter((call) => call.method === "POST").length).toBe(1)
    const created = api.callsTo("/profiles/").filter((call) => call.method === "POST")
    expect(created).toHaveLength(1)
    expect(created[0]?.body).toMatchObject({
      name: "Sky copy",
      default_engine_id: 1,
      resolver_id: 2, // the saved source's resolver, not the one in the picker
      resolver_config: { url: "http://sky.example/playlist.m3u8", quality: "720p" },
    })
  })

  test("the profile form grows a fallback chain once a source is picked", async ({ page, api }) => {
    await page.goto("/profiles")
    await page.getByRole("button", { name: "New profile" }).first().click()

    await expect(page.getByRole("heading", { name: "Fallbacks" })).toHaveCount(0)

    await page.getByRole("combobox", { name: /^Resolver/ }).selectOption("2")
    await expect(page.getByRole("heading", { name: "Fallbacks" })).toBeVisible()

    await page.getByRole("combobox", { name: "Fallback 1 · Resolver" }).selectOption("1")
    await page.getByRole("button", { name: "Add fallback" }).click()

    const chain = page.getByRole("list", { name: "Fallback sources, in order" })
    await expect(chain.getByText("Wide IPTV")).toBeVisible()
    await expect(page.getByRole("combobox", { name: "Fallback 2 · Resolver" })).toBeVisible()

    await page.getByLabel("Name").fill("Two sources")
    await page.getByRole("combobox", { name: /^Engine/ }).selectOption("1")
    await page.getByRole("button", { name: "Create profile" }).click()

    await expect.poll(() => api.callsTo("/profiles/").filter((call) => call.method === "POST").length).toBe(1)
    const created = api.callsTo("/profiles/").filter((call) => call.method === "POST")
    expect(created).toHaveLength(1)
    expect(created[0]?.body).toMatchObject({
      name: "Two sources",
      resolver_id: 2,
      fallback_sources: [{ resolver_id: 1, resolver_config: {} }],
    })
  })

  test("a saved chain shows on the row and reopens in the dialog", async ({ page, api }) => {
    api.data.profiles = [
      profile({
        id: 1,
        name: "F1 Weekend",
        resolver_id: 2,
        fallback_sources: [{ resolver_id: 1, resolver_config: {} }],
      }),
    ]
    await page.goto("/profiles")

    await expect(page.getByTitle("Fallbacks: Wide IPTV").first()).toBeVisible()

    await page.getByRole("button", { name: "Edit profile F1 Weekend" }).first().click()
    const chain = page.getByRole("list", { name: "Fallback sources, in order" })
    await expect(chain.getByText("Wide IPTV")).toBeVisible()

    await page.getByRole("button", { name: "Remove Wide IPTV" }).click()
    await page.getByRole("button", { name: "Save changes" }).click()

    const saved = api.callsTo("/profiles/1").filter((call) => call.method === "PUT")
    expect(saved).toHaveLength(1)
    expect(saved[0]?.body).toMatchObject({ fallback_sources: [] })
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
    // The resolver's discovery filter model is not rendered — the box below is
    // the only searchbox this panel has.
    await expect(drawer.getByLabel("Category")).toHaveCount(0)
    // Every page is read in the background: the whole catalog ends up held here.
    await expect(drawer.getByText("Eurosport 1")).toBeVisible()
    expect(api.callsTo("/discover")).toHaveLength(2)

    // Typing narrows what is already held — no request, so nothing waits on the
    // network while the words are being typed.
    await drawer.getByLabel("Search the catalog").fill("euro")
    await expect(drawer.getByText("Eurosport 1")).toBeVisible()
    await expect(drawer.getByText("Sky Sports Main Event")).toHaveCount(0)
    // The readout makes the re-rank visible: how much of the catalog matched.
    await expect(drawer.getByText("1 of 3 matches")).toBeVisible()
    expect(api.callsTo("/discover")).toHaveLength(2)
  })

  test("a wide match fills one screenful at a time", async ({ page, api }) => {
    // A few letters can match a whole catalog. Laying every match out at once is
    // what made the drawer stop answering keys on a phone, so the cards arrive
    // as the list is scrolled — while the readout still counts them all.
    api.data.discovery = Array.from({ length: 130 }, (_, index) => ({
      id: `bulk-${index}`,
      title: `Bulk Channel ${String(index + 1).padStart(3, "0")}`,
      config: { channel: `bulk${index}` },
    }))
    await page.goto("/profiles")
    await page.getByRole("button", { name: "New profile" }).first().click()
    await page.getByRole("combobox", { name: /^Resolver/ }).selectOption("1")
    await page.getByRole("button", { name: "Browse Wide IPTV…" }).click()

    const drawer = page.getByRole("dialog", { name: "Browse Wide IPTV" })
    await drawer.getByLabel("Search the catalog").fill("bulk")

    await expect(drawer.getByText("130 of 130 match")).toBeVisible()
    await expect(drawer.locator("li")).toHaveCount(60)

    await drawer.getByRole("list").evaluate((list) => {
      let box: HTMLElement | null = list.parentElement
      while (box !== null && box.scrollHeight <= box.clientHeight) box = box.parentElement
      if (box !== null) box.scrollTop = box.scrollHeight
    })
    await expect(drawer.locator("li")).toHaveCount(120)
  })

  test("the best match leads, even when the near-misses share more of its text", async ({ page, api }) => {
    // The behaviour the user went looking for: for "sky sport fl italy" the
    // near-exact "Sky Sport F1 Italy" must lead, not "Sky Sport 3 NZ" — which
    // shares neither "italy" nor any run with "fl" — and not "Sky Sport 258
    // Italia", whose "italia" only ever shares "ital" with "italy".
    api.data.discovery = [
      { id: "1", title: "Sky Sport 258 Italia", config: { channel: "a" } },
      { id: "2", title: "Sky Sport 3 NZ", config: { channel: "b" } },
      { id: "3", title: "Sky Sport F1 Italy", config: { channel: "c" } },
    ]
    await page.goto("/profiles")
    await page.getByRole("button", { name: "New profile" }).first().click()
    await page.getByRole("combobox", { name: /^Resolver/ }).selectOption("1")
    await page.getByRole("button", { name: "Browse Wide IPTV…" }).click()

    const drawer = page.getByRole("dialog", { name: "Browse Wide IPTV" })
    await drawer.getByLabel("Search the catalog").fill("sky sport fl italy")

    await expect(drawer.locator("li").first()).toContainText("Sky Sport F1 Italy")
  })

  test("a catalog resolver with no filter model still offers the browser", async ({ page, api }) => {
    api.data.resolvers = [...(api.data.resolvers ?? []), resolver({ id: 3, name: "Catalog Only", has_catalog: true })]
    await page.goto("/profiles")
    await page.getByRole("button", { name: "New profile" }).first().click()
    await page.getByRole("combobox", { name: /^Resolver/ }).selectOption("3")

    await expect(page.getByRole("button", { name: "Browse Catalog Only…" })).toBeVisible()
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

    await expect.poll(() => api.callsTo("/profiles/").filter((call) => call.method === "POST").length).toBe(1)
    const created = api.callsTo("/profiles/").filter((call) => call.method === "POST")
    expect(created).toHaveLength(1)
    expect(created[0]?.body).toMatchObject({
      name: "Sky copy",
      resolver_id: 1,
      resolver_config: { channel: "premium1" },
    })
  })

  test("both halves of the page select rows and raise the same bulk bar", async ({ page }) => {
    await page.goto("/profiles")
    const bulk = page.getByRole("region", { name: "Bulk actions" })

    await expect(bulk).toBeHidden()

    await page.getByRole("checkbox", { name: "Select F1 Weekend" }).check()
    await expect(bulk).toContainText("1 selected item")
    await expect(bulk.getByRole("button", { name: "Export selected" })).toBeVisible()
    await expect(bulk.getByRole("button", { name: "Delete selected" })).toBeVisible()

    await bulk.getByRole("button", { name: "Clear" }).click()
    await expect(bulk).toBeHidden()

    await page.getByRole("checkbox", { name: "Select Sky Sports" }).check()
    await expect(bulk).toContainText("1 selected item")
    await expect(bulk.getByRole("button", { name: "Delete selected" })).toBeVisible()
  })

  test("deleting a profile says which schedules it left needing one", async ({ page, api }) => {
    api.data.profileDeleteCounts = { flagged: 2 }
    await page.goto("/profiles")

    await page.getByRole("button", { name: "Delete profile F1 Weekend" }).click()
    await page
      .getByRole("dialog", { name: "Delete profile “F1 Weekend”?" })
      .getByRole("button", { name: "Delete" })
      .click()

    await expect(page.getByText("Profile deleted")).toBeVisible()
    await expect(
      page.getByText("2 scheduled recordings need a new profile — they will not run until you pick one."),
    ).toBeVisible()
  })

  test("a phone can select a profile and reach the bulk actions", async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await page.goto("/profiles")

    await page.getByRole("checkbox", { name: "Select F1 Weekend" }).check()

    const bulk = page.getByRole("region", { name: "Bulk actions" })
    await expect(bulk.getByRole("button", { name: "Delete selected" })).toBeInViewport()
    await expect(bulk.getByRole("button", { name: "Export selected" })).toBeInViewport()
  })

  test("a phone takes a whole panel from its own head", async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await page.goto("/profiles")

    const bulk = page.getByRole("region", { name: "Bulk actions" })

    await page.getByRole("checkbox", { name: "Select all profiles" }).check()
    await expect(bulk).toContainText("1 selected item")

    await page.getByRole("checkbox", { name: "Select all profiles" }).uncheck()
    await expect(bulk).toBeHidden()

    await page.getByRole("checkbox", { name: "Select all sources" }).check()
    await expect(bulk).toContainText("1 selected item")
    await expect(bulk.getByRole("button", { name: "Delete selected" })).toBeInViewport()
  })
})
