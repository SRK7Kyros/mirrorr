import { autorun, engine, expect, openFallbacks, profile, resolver, test } from "./fixtures"

/**
 * The fallback chain is an ordered list of rungs on the create/edit form. A rung
 * is a patch — a profile, a different engine, a different source, or any
 * combination — and the order the user builds is the order the server tries.
 */
/**
 * Each profile runs a stream of its own: two profiles on one source are one
 * capture, which the chain refuses as a repeat.
 */
const PROFILES = [
  profile({ id: 1, name: "F1 Weekend", resolver_id: 1, resolver_name: "Sky" }),
  profile({ id: 2, name: "News Hour", resolver_id: 2, resolver_name: "Eurosport" }),
  profile({ id: 3, name: "GB edge", resolver_id: 3, resolver_name: "Direct" }),
]

const ENGINES = [engine({ id: 1, name: "Streamlink" })]

/** The widest rung to lay out: a config form and a Browse button. */
const WIDE = resolver({
  id: 4,
  name: "Wide IPTV",
  has_catalog: true,
  config_schema: { type: "object", properties: { channel: { type: "string", title: "Channel" } } },
})

const RESOLVERS = [
  resolver({ id: 1, name: "Sky" }),
  resolver({ id: 2, name: "Eurosport" }),
  resolver({ id: 3, name: "Direct" }),
  WIDE,
]

async function openCreate(page: import("@playwright/test").Page) {
  await page.goto("/autoruns")
  await page.getByRole("button", { name: "New scheduled recording" }).first().click()
  await expect(page.getByRole("dialog")).toBeVisible()
}

/** A content-sized track widens the dialog instead of wrapping — its one past layout bug. */
async function expectNoOverflow(dialog: import("@playwright/test").Locator): Promise<void> {
  const [scrollWidth, clientWidth] = await dialog.evaluate((node) => [
    node.scrollWidth,
    node.clientWidth,
  ])
  expect(scrollWidth, "the dialog scrolls sideways").toBeLessThanOrEqual(clientWidth + 1)
  const box = await dialog.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x, "the dialog starts off-screen").toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width, "the dialog runs off the screen").toBeLessThanOrEqual(376)
}

function chainList(dialog: import("@playwright/test").Locator) {
  return dialog.getByRole("list", { name: "Fallback chain, in order" }).getByRole("listitem")
}

test.describe("fallback chain", () => {
  test.beforeEach(async ({ api }) => {
    api.data.autoruns = [autorun({ id: 1, user_friendly_name: "Zulu", snake_case_name: "zulu" })]
    api.data.profiles = PROFILES
    api.data.engines = ENGINES
    api.data.resolvers = RESOLVERS
  })

  test("builds an ordered chain of profile rungs", async ({ page }) => {
    await openCreate(page)
    const dialog = page.getByRole("dialog")
    await dialog.locator("#autorun-profile").selectOption("1")

    // Optional everywhere, so it starts folded with just its summary showing.
    await expect(dialog.locator('[data-chain-section="closed"]')).toBeVisible()
    await openFallbacks(dialog)

    await dialog.locator("#autorun-fallback-profile").selectOption("2")
    await dialog.getByRole("button", { name: "Add fallback" }).click()
    await dialog.locator("#autorun-fallback-profile").selectOption("3")
    await dialog.getByRole("button", { name: "Add fallback" }).click()

    const chips = chainList(dialog)
    await expect(chips).toHaveCount(2)
    await expect(chips.nth(0)).toContainText("News Hour")
    await expect(chips.nth(1)).toContainText("GB edge")

    await dialog.getByRole("button", { name: "Move fallback 2 up" }).click()
    await expect(chips.nth(0)).toContainText("GB edge")
    await expect(chips.nth(1)).toContainText("News Hour")
    await expect(dialog.getByRole("button", { name: "Move fallback 1 up" })).toBeDisabled()

    await dialog.getByRole("button", { name: "Remove fallback 2" }).click()
    await expect(chips).toHaveCount(1)
    await expect(chips.nth(0)).toContainText("GB edge")
  })

  test("refuses a rung that changes nothing, then drops it once it becomes one", async ({
    page,
  }) => {
    await openCreate(page)
    const dialog = page.getByRole("dialog")
    await dialog.locator("#autorun-profile").selectOption("1")

    // News Hour is a real change; F1 Weekend is the capture before the chain.
    await openFallbacks(dialog)
    await dialog.locator("#autorun-fallback-profile").selectOption("1")
    const add = dialog.getByRole("button", { name: "Add fallback" })
    await expect(add).toBeDisabled()
    await expect(dialog.getByText(/Fallback 1 is the run.s own source/)).toBeVisible()

    await dialog.locator("#autorun-fallback-profile").selectOption("2")
    await expect(add).toBeEnabled()
    await add.click()
    await expect(chainList(dialog)).toHaveCount(1)

    // The run's own profile moves onto that rung, so the rung can no longer run.
    await dialog.locator("#autorun-profile").selectOption("2")
    await expect(chainList(dialog)).toHaveCount(0)
  })

  test("sends the chain in the order it was built", async ({ page, api }) => {
    await openCreate(page)
    const dialog = page.getByRole("dialog")

    await dialog.locator("#autorun-friendly").fill("Race")
    await dialog.locator("#autorun-profile").selectOption("1")
    await openFallbacks(dialog)
    await dialog.locator("#autorun-fallback-profile").selectOption("3")
    await dialog.getByRole("button", { name: "Add fallback" }).click()
    await dialog.locator("#autorun-fallback-profile").selectOption("2")
    await dialog.getByRole("button", { name: "Add fallback" }).click()
    await dialog.locator("#autorun-start").fill("2026-11-01T10:00")
    await dialog.locator("#autorun-end").fill("2026-11-01T12:00")

    await dialog.getByRole("button", { name: "Create scheduled recording" }).click()

    await expect(page.getByText("Scheduled recording created")).toBeVisible()
    const [post] = api.callsTo("/autoruns/").filter((call) => call.method === "POST")
    expect(post?.body).toMatchObject({
      user_friendly_name: "Race",
      profile_id: 1,
      fallback_chain: [{ profile_id: 3 }, { profile_id: 2 }],
    })
  })

  test("a chain of profiles survives the switch to an engine + resolver run", async ({
    page,
    api,
  }) => {
    api.data.autoruns = [
      autorun({
        id: 2,
        user_friendly_name: "Mixed",
        snake_case_name: "mixed",
        profile_id: 1,
        fallback_chain: [{ profile_id: 2 }, { profile_id: 3 }],
      }),
    ]

    await page.goto("/autoruns")
    await page.getByRole("button", { name: "Actions for Mixed" }).click()
    await page.getByRole("menuitem", { name: "Edit" }).click()
    const dialog = page.getByRole("dialog")
    await expect(chainList(dialog)).toHaveCount(2)

    // A profile rung does not care what the run's own capture is — the chain runs
    // exactly as it was written, so switching the run must not throw it away.
    await dialog.getByRole("tab", { name: "Engine + resolver" }).click()
    await dialog.locator("#autorun-engine").selectOption("1")
    await dialog.locator("#autorun-resolver").selectOption("4")
    await expect(chainList(dialog)).toHaveCount(2)
    await dialog.getByRole("button", { name: "Save changes" }).click()

    const putCalls = () => api.callsTo("/autoruns/").filter((call) => call.method === "PUT")
    await expect.poll(() => putCalls().length).toBe(1)
    expect(putCalls()[0]?.body).toMatchObject({
      fallback_chain: [{ profile_id: 2 }, { profile_id: 3 }],
    })
  })

  test("a rung patches the run's own capture, never the rung above it", async ({ page }) => {
    await openCreate(page)
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("tab", { name: "Engine + resolver" }).click()
    await dialog.locator("#autorun-engine").selectOption("1")
    await dialog.locator("#autorun-resolver").selectOption("4")

    await openFallbacks(dialog)

    // The rung's preview says what it will actually run before it is added.
    await expect(dialog.locator('[data-chain-preview="empty"]')).toBeVisible()
    await dialog.locator("#autorun-fallback-resolver").selectOption("4")
    await dialog.locator("#autorun-fallback-1-channel").fill("premium9")
    await expect(dialog.locator('[data-chain-preview="runs"]')).toContainText("premium9")

    await dialog.getByRole("button", { name: "Add fallback" }).click()
    const chips = chainList(dialog)
    await expect(chips).toHaveCount(1)
    await expect(chips.nth(0)).toContainText("premium9")

    // A second rung starts from the run's own capture again, so naming only the
    // engine it already runs is that same capture — not the stream above it.
    await dialog.locator("#autorun-fallback-engine").selectOption("1")
    await expect(dialog.locator('[data-chain-preview="runs"]')).not.toContainText("premium9")
    await expect(dialog.getByText(/is the run’s own source/)).toBeVisible()
  })

  test("dragging a card's grip reorders the chain", async ({ page }) => {
    await openCreate(page)
    const dialog = page.getByRole("dialog")
    await dialog.locator("#autorun-profile").selectOption("1")
    await openFallbacks(dialog)
    await dialog.locator("#autorun-fallback-profile").selectOption("2")
    await dialog.getByRole("button", { name: "Add fallback" }).click()
    await dialog.locator("#autorun-fallback-profile").selectOption("3")
    await dialog.getByRole("button", { name: "Add fallback" }).click()

    const cards = chainList(dialog)
    await expect(cards).toHaveCount(2)
    await expect(cards.nth(0)).toContainText("News Hour")

    // The grip is the handle — a draggable card would swallow the fields' text selection.
    await cards.nth(1).locator('[title="Drag to reorder"]').dragTo(cards.nth(0))
    await expect(cards.nth(0)).toContainText("GB edge")
    await expect(cards.nth(1)).toContainText("News Hour")
  })

  test("a card says what it changes and what it runs instead", async ({ api, page }) => {
    api.data.autoruns = [
      autorun({
        id: 2,
        user_friendly_name: "Mixed",
        snake_case_name: "mixed",
        profile_id: 1,
        fallback_chain: [{ profile_id: 2 }, { resolver_id: 4, resolver_config: { channel: "premium9" } }],
      }),
    ]
    await page.goto("/autoruns")
    await page.getByRole("button", { name: "Actions for Mixed" }).click()
    await page.getByRole("menuitem", { name: "Edit" }).click()
    const dialog = page.getByRole("dialog")
    const cards = chainList(dialog)

    // A profile rung takes a profile and the source that came with it.
    // A profile rung takes a profile and the source that came with it.
    await expect(cards.nth(0).locator("[data-change]")).toHaveCount(2)
    await expect(cards.nth(0).locator('[data-change="profile"]')).toContainText("News Hour")
    await expect(cards.nth(0).locator("[data-rung-trail]")).toContainText("F1 Weekend · Sky")

    // A source rung takes a source only — it does not drop the profile it inherits.
    await expect(cards.nth(1).locator("[data-change]")).toHaveCount(1)
    await expect(cards.nth(1).locator('[data-change="source"]')).toContainText("premium9")
    await expect(cards.nth(1).locator('[data-change="profile"]')).toHaveCount(0)
  })

  test("a phone width holds a whole chain without widening the dialog", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 })
    await openCreate(page)
    const dialog = page.getByRole("dialog")

    await dialog.locator("#autorun-profile").selectOption("1")
    await openFallbacks(dialog)
    await dialog.locator("#autorun-fallback-profile").selectOption("2")
    await dialog.getByRole("button", { name: "Add fallback" }).click()
    await dialog.locator("#autorun-fallback-profile").selectOption("3")
    await dialog.getByRole("button", { name: "Add fallback" }).click()
    await expect(chainList(dialog)).toHaveCount(2)
    await expectNoOverflow(dialog)

    await dialog.getByRole("tab", { name: "Engine + resolver" }).click()
    await dialog.locator("#autorun-engine").selectOption("1")
    await dialog.locator("#autorun-resolver").selectOption("4")
    await dialog.locator("#autorun-fallback-resolver").selectOption("4")

    // A rung equal to the run's own source is refused by name, not by silence.
    const addRung = dialog.getByRole("button", { name: "Add fallback" })
    await expect(addRung).toBeDisabled()
    await expect(dialog.getByText(/Fallback 3 is the run.s own source/)).toBeVisible()
    await expectNoOverflow(dialog)

    await dialog.locator("#autorun-fallback-3-channel").fill("premium9")
    await addRung.click()
    await expect(chainList(dialog)).toHaveCount(3)
    await expectNoOverflow(dialog)
  })

  test("a rung browses its own resolver's catalog", async ({ page, api }) => {
    api.data.discovery = [{ id: "9", title: "Sky Sports F1", config: { channel: "premium9" } }]

    await openCreate(page)
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("tab", { name: "Engine + resolver" }).click()
    await dialog.locator("#autorun-engine").selectOption("1")
    await dialog.locator("#autorun-resolver").selectOption("4")

    await openFallbacks(dialog)

    // Only the run's own source is browsable until the rung names a resolver.
    const browse = dialog.getByRole("button", { name: "Browse Wide IPTV…" })
    await expect(browse).toHaveCount(1)
    await dialog.locator("#autorun-fallback-resolver").selectOption("4")
    await expect(browse).toHaveCount(2)

    await browse.nth(1).click()
    await page
      .getByRole("dialog", { name: "Browse Wide IPTV" })
      .getByRole("button", { name: "Use" })
      .first()
      .click()

    await expect(dialog.locator("#autorun-fallback-1-channel")).toHaveValue("premium9")
  })
})
