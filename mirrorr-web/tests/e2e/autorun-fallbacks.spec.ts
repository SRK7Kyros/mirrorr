import { autorun, engine, expect, profile, resolver, test } from "./fixtures"

/**
 * The fallback chain is an ordered list on the create/edit form: the primary
 * profile is never offered as a rung, each rung can be moved and removed, and
 * the order the user builds is the order the server tries.
 */
const PROFILES = [
  profile({ id: 1, name: "F1 Weekend" }),
  profile({ id: 2, name: "News Hour" }),
  profile({ id: 3, name: "GB edge" }),
]

async function openCreate(page: import("@playwright/test").Page) {
  await page.goto("/autoruns")
  await page.getByRole("button", { name: "New scheduled recording" }).first().click()
  await expect(page.getByRole("dialog")).toBeVisible()
}

test.describe("fallback profiles", () => {
  test.beforeEach(async ({ api }) => {
    api.data.autoruns = [autorun({ id: 1, user_friendly_name: "Zulu", snake_case_name: "zulu" })]
    api.data.profiles = PROFILES
  })

  test("builds an ordered chain that never repeats the primary", async ({ page }) => {
    await openCreate(page)
    const dialog = page.getByRole("dialog")
    const add = dialog.getByLabel("Add a fallback profile")

    await dialog.locator("#autorun-profile").selectOption("1")
    await expect(add.locator("option")).toHaveText([
      "Add a fallback profile…",
      "News Hour",
      "GB edge",
    ])

    await add.selectOption("2")
    await add.selectOption("3")
    const chips = dialog.getByRole("list", { name: "Fallback profiles, in order" }).getByRole("listitem")
    await expect(chips).toHaveCount(2)
    await expect(chips.nth(0)).toContainText("News Hour")
    await expect(chips.nth(1)).toContainText("GB edge")
    await expect(add.locator("option")).toHaveCount(1)

    await dialog.getByRole("button", { name: "Move GB edge up" }).click()
    await expect(chips.nth(0)).toContainText("GB edge")
    await expect(chips.nth(1)).toContainText("News Hour")
    await expect(dialog.getByRole("button", { name: "Move GB edge up" })).toBeDisabled()

    await dialog.getByRole("button", { name: "Remove News Hour" }).click()
    await expect(chips).toHaveCount(1)
    await expect(chips.nth(0)).toContainText("GB edge")
  })

  test("picking a fallback as the primary drops it from the chain", async ({ page }) => {
    await openCreate(page)
    const dialog = page.getByRole("dialog")

    await dialog.locator("#autorun-profile").selectOption("1")
    await dialog.getByLabel("Add a fallback profile").selectOption("2")
    const chips = dialog.getByRole("list", { name: "Fallback profiles, in order" }).getByRole("listitem")
    await expect(chips).toHaveCount(1)

    await dialog.locator("#autorun-profile").selectOption("2")
    await expect(chips).toHaveCount(0)
    await expect(dialog.getByLabel("Add a fallback profile").locator("option")).toHaveText([
      "Add a fallback profile…",
      "F1 Weekend",
      "GB edge",
    ])
  })

  test("sends the chain in the order it was built", async ({ page, api }) => {
    await openCreate(page)
    const dialog = page.getByRole("dialog")

    await dialog.locator("#autorun-friendly").fill("Race")
    await dialog.locator("#autorun-profile").selectOption("1")
    await dialog.getByLabel("Add a fallback profile").selectOption("3")
    await dialog.getByLabel("Add a fallback profile").selectOption("2")
    await dialog.locator("#autorun-start").fill("2026-11-01T10:00")
    await dialog.locator("#autorun-end").fill("2026-11-01T12:00")

    await dialog.getByRole("button", { name: "Create scheduled recording" }).click()

    await expect(page.getByText("Scheduled recording created")).toBeVisible()
    const [post] = api.callsTo("/autoruns/").filter((call) => call.method === "POST")
    expect(post?.body).toMatchObject({
      user_friendly_name: "Race",
      profile_id: 1,
      fallback_profile_ids: [3, 2],
    })
  })

  test("an engine + resolver run clears the chain", async ({ page, api }) => {
    api.data.engines = [engine({ id: 1, name: "Streamlink" })]
    api.data.resolvers = [resolver({ id: 1, name: "Direct" })]
    api.data.autoruns = [
      autorun({
        id: 2,
        user_friendly_name: "Mixed",
        snake_case_name: "mixed",
        profile_id: 1,
        fallback_profile_ids: [2, 3],
        fallback_profile_names: ["News Hour", "GB edge"],
      }),
    ]

    await page.goto("/autoruns")
    await page.getByRole("button", { name: "Actions for Mixed" }).click()
    await page.getByRole("menuitem", { name: "Edit" }).click()
    const dialog = page.getByRole("dialog")
    await expect(
      dialog.getByRole("list", { name: "Fallback profiles, in order" }).getByRole("listitem"),
    ).toHaveCount(2)

    await dialog.getByRole("tab", { name: "Engine + resolver" }).click()
    await dialog.locator("#autorun-engine").selectOption("1")
    await dialog.locator("#autorun-resolver").selectOption("1")
    await dialog.getByRole("button", { name: "Save changes" }).click()

    const [put] = api.callsTo("/autoruns/").filter((call) => call.method === "PUT")
    expect(put?.body).toMatchObject({ fallback_profile_ids: [] })
  })
})
