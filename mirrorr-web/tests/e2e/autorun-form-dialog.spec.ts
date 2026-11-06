import { autorun, engine, expect, profile, resolver, test } from "./fixtures"

/**
 * The autorun form's own behaviour: every catalog has all three states, Start
 * is locked while a run is live, no close path discards work silently, and the
 * footer never covers the last field at 375 (`AUT-02`, `AUT-07`, `AUT-11`,
 * `FLW-04`, `FLW-07`).
 */

const PROFILES = [profile({ id: 1, name: "F1 Weekend", resolver_id: 1, resolver_name: "Sky" })]
const ENGINES = [engine({ id: 1, name: "Streamlink" })]
const RESOLVERS = [resolver({ id: 1, name: "Sky" })]

async function openCreate(page: import("@playwright/test").Page) {
  await page.goto("/autoruns")
  await page.getByRole("button", { name: "New autorun" }).first().click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  return dialog
}

test.use({ hasTouch: true })

test.describe("p6 probe", () => {
  test.beforeEach(async ({ api }) => {
    api.data.autoruns = []
    api.data.profiles = PROFILES
    api.data.engines = ENGINES
    api.data.resolvers = RESOLVERS
  })

  test("AUT-07 profile list failure: retry, named reason, describedby", async ({ page, api }) => {
    api.data.failures = [{ path: "/profiles/", status: 500 }]
    const dialog = await openCreate(page)

    const retry = dialog.getByRole("button", { name: "Retry" })
    await expect(retry).toBeVisible()
    await expect(dialog).toContainText("The profile list did not load")

    const primary = dialog.getByRole("button", { name: "Create autorun" })
    await expect(primary).toBeDisabled()
    const reason =
      "The profile list did not load — retry it above before saving."
    await expect(dialog.getByText(reason, { exact: true })).toBeVisible()
    const describedBy = await primary.getAttribute("aria-describedby")
    expect(describedBy).not.toBeNull()
    const described = await dialog.locator(`#${describedBy}`).innerText()
    expect(described).toBe(reason)

    api.data.failures = []
    await retry.click()
    await expect(dialog.locator("#autorun-profile")).toBeVisible()
    await expect(dialog.getByText(reason, { exact: true })).toHaveCount(0)
  })

  test("AUT-07 engine list failure in custom mode", async ({ page, api }) => {
    api.data.failures = [{ path: "/engines/", status: 500 }]
    const dialog = await openCreate(page)
    await dialog.getByRole("tab", { name: "Engine + resolver" }).click()

    await expect(dialog.getByRole("button", { name: "Retry" })).toBeVisible()
    const reason = "The engine list did not load — retry it above before saving."
    await expect(dialog.getByText(reason, { exact: true })).toBeVisible()
    const primary = dialog.getByRole("button", { name: "Create autorun" })
    await expect(primary).toBeDisabled()
    expect(await primary.getAttribute("aria-describedby")).not.toBeNull()
  })

  test("AUT-07 loading branch is a skeleton, not an empty select", async ({ page, api }) => {
    api.data.latency = [{ path: "/profiles/", delayMs: 1500 }]
    const dialog = await openCreate(page)
    await expect(dialog.getByRole("status", { name: "Loading profiles" })).toBeVisible()
    await expect(dialog.getByRole("button", { name: "Create autorun" })).toBeDisabled()
    await expect(dialog.locator("#autorun-profile")).toBeVisible({ timeout: 5000 })
  })

  test("AUT-02 a live run locks Start, and the payload still omits it", async ({ page, api }) => {
    api.data.autoruns = [
      autorun({
        id: 1,
        user_friendly_name: "Live one",
        snake_case_name: "live-one",
        status: "recording",
        profile_id: 1,
        start_time: "2026-11-06 18:00:00",
        end_time: "2026-11-06 20:00:00",
      }),
    ]
    await page.goto("/autoruns")
    await page.getByRole("button", { name: "Actions for Live one" }).click()
    await page.getByRole("menuitem", { name: "Edit" }).click()
    const dialog = page.getByRole("dialog")

    const start = dialog.locator("#autorun-start")
    await expect(start).toBeDisabled()
    await expect(dialog.getByText(/Start can’t move once running/)).toBeVisible()
    const describedBy = await start.getAttribute("aria-describedby")
    expect(describedBy).toContain("autorun-start-lock")
    expect(describedBy).toContain("autorun-window-note")

    await dialog.locator("#autorun-friendly").fill("Live two")
    await dialog.getByRole("button", { name: "Save changes" }).click()
    await expect(page.getByText("Autorun updated")).toBeVisible()
    const [put] = api.callsTo("/autoruns/").filter((call) => call.method === "PUT")
    expect(put?.body).not.toHaveProperty("start_time")
    expect(put?.body).toMatchObject({ user_friendly_name: "Live two", profile_id: 1 })
  })

  test("one timezone note, and focus comes back to the opener", async ({ page }) => {
    const opener = page.getByRole("button", { name: "New autorun" }).first()
    await page.goto("/autoruns")
    await opener.click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()

    // AUT-11: one helper for the pair, not one under each picker.
    await expect(dialog.getByText(/local zone/)).toHaveCount(1)
    await expect(dialog.getByText(/stored as UTC|stores UTC/)).toHaveCount(1)
    await expect(dialog.getByText("Runs once at its start time, then retires.")).toBeVisible()

    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
    await expect(opener).toBeFocused()
  })

  test("dirty guard: untouched closes, typed asks and can be kept", async ({ page }) => {
    let dialog = await openCreate(page)
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole("dialog", { name: "Discard this autorun?" })).toHaveCount(0)

    dialog = await openCreate(page)
    await dialog.locator("#autorun-friendly").fill("Race night")
    await page.keyboard.press("Escape")
    const prompt = page.getByRole("dialog", { name: "Discard this autorun?" })
    await expect(prompt).toBeVisible()
    await expect(prompt).toContainText("Unsaved: the name and the slug.")
    await prompt.getByRole("button", { name: "Keep editing" }).click()
    await expect(prompt).toHaveCount(0)
    await expect(dialog.locator("#autorun-friendly")).toHaveValue("Race night")

    // Cancel goes through the same prompt, and Discard really closes.
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(prompt).toBeVisible()
    await prompt.getByRole("button", { name: "Discard" }).click()
    await expect(page.getByRole("dialog", { name: "New autorun" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "New autorun" }).first()).toBeFocused()
  })

  test("dirty guard: an untouched edit of a staged chain does not ask", async ({ page, api }) => {
    api.data.autoruns = [
      autorun({ id: 2, user_friendly_name: "Chained", snake_case_name: "chained", profile_id: 1 }),
    ]
    await page.goto("/autoruns")
    await page.getByRole("button", { name: "Actions for Chained" }).click()
    await page.getByRole("menuitem", { name: "Edit" }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
  })

  test("375: measure the footer and the clearance it needs", async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 640 })

    const measure = async () =>
      (await page.getByRole("dialog").evaluate((node) => {
        const footer = node.querySelector("footer") as HTMLElement | null
        const body = Array.from(node.children).find(
          (child) => getComputedStyle(child).overflowY === "auto",
        ) as HTMLElement | undefined
        if (footer === null || body === undefined) return null
        body.scrollTop = body.scrollHeight
        const footerRect = footer.getBoundingClientRect()
        const root = body.firstElementChild as HTMLElement
        const children = Array.from(root.children)
        // The last child is the aria-hidden spacer; the field before it is the form's end.
        const tail = children[children.length - 1]?.getBoundingClientRect()
        const field = children[children.length - 2]?.getBoundingClientRect()
        return {
          footerHeight: Math.round(footerRect.height),
          footerTop: Math.round(footerRect.top),
          footerText: (footer.innerText ?? "").replace(/\n/g, " | "),
          bodyScrollTop: body.scrollTop,
          bodyScrollHeight: body.scrollHeight,
          bodyClientHeight: body.clientHeight,
          bodyBottom: Math.round(body.getBoundingClientRect().bottom),
          spacerHeight: tail === undefined ? null : Math.round(tail.height),
          lastFieldBottom: field === undefined ? null : Math.round(field.bottom),
          clearance: field === undefined ? null : Math.round(footerRect.top - field.bottom),
        }
      })) as Record<string, number> | null

    await openCreate(page)
    const create = (await measure()) as Record<string, number>
    expect(create.clearance).toBeGreaterThanOrEqual(create.footerHeight)

    api.data.failures = [{ path: "/engines/", status: 500 }]
    await page.reload()
    await page.getByRole("button", { name: "New autorun" }).first().click()
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("tab", { name: "Engine + resolver" }).click()
    await expect(dialog.getByRole("button", { name: "Retry" })).toBeVisible()
    const failed = (await measure()) as Record<string, number>
    expect(failed.clearance).toBeGreaterThanOrEqual(failed.footerHeight)
  })
})
