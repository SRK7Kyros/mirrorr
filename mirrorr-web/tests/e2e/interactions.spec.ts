import { engine, expect, profile, resolver, session, source, test } from "./fixtures"

/**
 * Overlay + keyboard interactions: Escape closes the dialog and hands focus
 * back to its trigger, the new-session form resets between openings (the
 * `openedRef` latch), the segmented control moves with the arrow keys, an
 * inline form owns Tab until Escape hands focus back out, and the shell is not
 * text-selectable while its fields are.
 */
const PROFILES = [profile({ id: 1, name: "F1 Weekend" }), profile({ id: 2, name: "News Hour" })]

const BROWSABLE = resolver({
  id: 1,
  name: "Wide IPTV",
  has_catalog: true,
  search_schema: { type: "object", properties: { category: { type: "string", title: "Category" } } },
  config_schema: { type: "object", properties: { channel: { type: "string", title: "Channel" } } },
})

test.describe("new session dialog", () => {
  test.beforeEach(async ({ api }) => {
    api.data.profiles = PROFILES
  })

  test("Escape closes it and hands focus back to the trigger", async ({ page }) => {
    await page.goto("/sessions")

    const trigger = page.getByRole("button", { name: "New session" }).first()
    await trigger.click()

    const dialog = page.getByRole("dialog", { name: "New session" })
    await expect(dialog).toBeVisible()

    await page.keyboard.press("Escape")

    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
  })

  test("the chosen profile is cleared the next time it opens", async ({ page }) => {
    await page.goto("/sessions")

    const trigger = page.getByRole("button", { name: "New session" }).first()
    await trigger.click()

    // Role-scoped: the tabpanel is named after its tab, so label-based locators are ambiguous.
    const profileSelect = page.getByRole("combobox", { name: /^Profile/ })
    await profileSelect.selectOption("1")
    await expect(profileSelect).toHaveValue("1")
    await expect(page.getByRole("button", { name: "Start session" })).toBeEnabled()

    await page.keyboard.press("Escape")
    await trigger.click()

    await expect(profileSelect).toHaveValue("")
    await expect(page.getByRole("button", { name: "Start session" })).toBeDisabled()
  })

  test("the standard build offers no access section in a creation panel", async ({ page }) => {
    await page.goto("/sessions")
    await page.getByRole("button", { name: "New session" }).first().click()

    const dialog = page.getByRole("dialog", { name: "New session" })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId("access-creation")).toHaveCount(0)
  })

  test("ArrowRight moves the segmented control and swaps the form", async ({ page }) => {
    await page.goto("/sessions")
    await page.getByRole("button", { name: "New session" }).first().click()

    const profileTab = page.getByRole("tab", { name: "A profile" })
    const customTab = page.getByRole("tab", { name: "Engine + resolver" })
    await expect(profileTab).toHaveAttribute("aria-selected", "true")
    await expect(page.getByRole("combobox", { name: /^Profile/ })).toBeVisible()

    await profileTab.focus()
    await page.keyboard.press("ArrowRight")

    await expect(customTab).toBeFocused()
    await expect(customTab).toHaveAttribute("aria-selected", "true")
    await expect(page.getByRole("combobox", { name: /^Engine/ })).toBeVisible()
  })

  test("the custom branch browses the resolver's catalog too", async ({ page, api }) => {
    api.data.resolvers = [BROWSABLE]
    api.data.discovery = [{ id: "9", title: "Sky Sports F1", config: { channel: "premium9" } }]
    await page.goto("/sessions")
    await page.getByRole("button", { name: "New session" }).first().click()
    await page.getByRole("tab", { name: "Engine + resolver" }).click()
    await page.getByRole("combobox", { name: /^Resolver/ }).selectOption("1")

    await page.getByRole("button", { name: "Browse Wide IPTV…" }).click()
    await page.getByRole("dialog", { name: "Browse Wide IPTV" }).getByRole("button", { name: "Use" }).first().click()

    await expect(page.getByLabel("Channel")).toHaveValue("premium9")
  })
  test("a session started from a profile chains fallback profiles", async ({ page, api }) => {
    api.data.engines = [engine({ id: 1, name: "Streamlink" })]
    api.data.resolvers = [resolver({ id: 1, name: "Direct" })]
    api.data.sessions = [session({ id: 1 })]

    await page.goto("/sessions")
    await page.getByRole("button", { name: "New session" }).first().click()
    await page.getByRole("combobox", { name: /^Profile/ }).selectOption("1")

    const add = page.getByLabel("Add a fallback profile")
    await expect(add.locator("option")).toHaveText(["Add a fallback profile…", "News Hour"])
    await add.selectOption("2")
    await expect(
      page.getByRole("list", { name: "Fallback profiles, in order" }).getByRole("listitem"),
    ).toHaveCount(1)

    await page.getByRole("button", { name: "Start session" }).click()

    await expect(page.getByText("Session started")).toBeVisible()
    const [post] = api.callsTo("/sessions/").filter((call) => call.method === "POST")
    expect(post?.body).toMatchObject({ profile_id: 1, fallback_profile_ids: [2] })
  })

  test("the custom branch chains fallback sources", async ({ page, api }) => {
    api.data.engines = [engine({ id: 1, name: "Streamlink" })]
    api.data.resolvers = [
      resolver({
        id: 1,
        name: "Direct",
        config_schema: {
          type: "object",
          properties: { channel: { type: "string", title: "Channel" } },
        },
      }),
    ]
    api.data.sources = [
      source({ id: 1, name: "Sky Sports", resolver_id: 1, resolver_config: { channel: "premium9" } }),
    ]
    api.data.sessions = [session({ id: 1 })]

    await page.goto("/sessions")
    await page.getByRole("button", { name: "New session" }).first().click()
    await page.getByRole("tab", { name: "Engine + resolver" }).click()
    await page.getByRole("combobox", { name: /^Engine/ }).selectOption("1")
    await page.getByRole("combobox", { name: /^Resolver/ }).selectOption("1")

    const add = page.getByLabel("Add a fallback source")
    await expect(add.locator("option")).toHaveText([
      "Add a fallback source…",
      "Sky Sports — Direct",
      "Direct",
    ])
    await add.selectOption("source:1")

    const chain = page.getByRole("list", { name: "Fallback sources, in order" })
    await expect(chain.getByRole("listitem")).toHaveCount(1)
    await expect(chain.getByRole("listitem").first()).toContainText("Sky Sports")

    await add.selectOption("resolver:1")
    await page.locator("#fallback-source-1-channel").fill("premium77")
    await page.getByRole("button", { name: "Add fallback" }).click()
    await expect(chain.getByRole("listitem")).toHaveCount(2)

    await page.getByRole("button", { name: "Start session" }).click()

    await expect(page.getByText("Session started")).toBeVisible()
    const [post] = api.callsTo("/sessions/").filter((call) => call.method === "POST")
    expect(post?.body).toMatchObject({
      engine_id: 1,
      resolver_id: 1,
      fallback_sources: [
        { resolver_id: 1, resolver_config: { channel: "premium9" } },
        { resolver_id: 1, resolver_config: { channel: "premium77" } },
      ],
    })
  })
})

test.describe("inline forms", () => {
  test("Tab cycles the account form and Escape hands focus back out of it", async ({ page }) => {
    await page.goto("/settings")

    const current = page.getByLabel("Current password")
    const confirm = page.getByLabel("Confirm new password")

    await confirm.focus()
    await page.keyboard.press("Tab")
    await expect(current).toBeFocused()

    await page.keyboard.press("Shift+Tab")
    await expect(confirm).toBeFocused()

    await page.keyboard.press("Escape")
    await expect(page.getByRole("button", { name: "Sign out" })).toBeFocused()
  })

  test("the shell is not text-selectable, the fields are", async ({ page }) => {
    await page.goto("/sessions")

    await expect(page.locator("body")).toHaveCSS("user-select", "none")
    await expect(page.locator("a[href]").first()).toHaveCSS("user-select", "none")
    await expect(page.locator('input:not([type="checkbox"])').first()).toHaveCSS("user-select", "text")
  })
})