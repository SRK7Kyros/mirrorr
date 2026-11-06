import type { Page } from "@playwright/test"
import { engine, expect, profile, resolver, source, test, type ApiStub } from "./fixtures"

const MOBILE = { width: 375, height: 812 }

const STREAMLINK = engine({
  id: 1,
  name: "Streamlink",
  retry_modes_schema: {
    none: { schema: { type: "object", properties: {} }, default_params: {} },
    quick: {
      schema: { type: "object", properties: { attempts: { type: "integer", title: "Attempts" } } },
      default_params: { attempts: 3 },
    },
  },
})

const WIDE = resolver({
  id: 1,
  name: "Wide IPTV",
  config_schema: {
    type: "object",
    properties: {
      channel: { type: "string", title: "Channel" },
      quality: { type: "string", title: "Quality" },
      user_agent: { type: "string", title: "User agent" },
    },
  },
})

function seed(api: ApiStub) {
  api.data.engines = [STREAMLINK]
  api.data.resolvers = [WIDE, resolver({ id: 2, name: "Daddy Live" })]
  api.data.profiles = [profile({ id: 1, name: "F1 Weekend" })]
  api.data.sources = [source({ id: 9, name: "Sky Sports", resolver_id: 1 })]
}

async function openNewProfile(page: Page) {
  await page.goto("/profiles")
  await page.getByRole("button", { name: "New profile" }).first().click()
  await expect(page.getByRole("dialog", { name: "New profile" })).toBeVisible()
}

test.describe("dirty guard", () => {
  test("an untouched dialog closes without asking, by Escape and by Cancel", async ({ page, api }) => {
    seed(api)
    await openNewProfile(page)

    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog", { name: "New profile" })).toBeHidden()
    await expect(page.getByRole("dialog", { name: "Discard changes?" })).toHaveCount(0)

    await page.getByRole("button", { name: "New profile" }).first().click()
    await page.getByRole("button", { name: "Cancel" }).click()
    await expect(page.getByRole("dialog", { name: "New profile" })).toBeHidden()
    await expect(page.getByRole("dialog", { name: "Discard changes?" })).toHaveCount(0)
  })

  test("a typed name makes Cancel ask first, and Keep editing keeps the text", async ({ page, api }) => {
    seed(api)
    await openNewProfile(page)
    await page.getByLabel("Name").fill("Nightly news")

    await page.getByRole("button", { name: "Cancel" }).click()
    const confirm = page.getByRole("dialog", { name: "Discard changes?" })
    await expect(confirm).toBeVisible()
    await expect(confirm).toContainText("the name")
    await expect(confirm).toContainText("discards it")

    await confirm.getByRole("button", { name: "Keep editing" }).click()
    await expect(confirm).toBeHidden()
    await expect(page.getByLabel("Name")).toHaveValue("Nightly news")

    await page.getByRole("button", { name: "Cancel" }).click()
    await page.getByRole("dialog", { name: "Discard changes?" }).getByRole("button", { name: "Discard" }).click()
    await expect(page.getByRole("dialog", { name: "New profile" })).toBeHidden()

    // Reopening is a fresh form — the discarding was real.
    await page.getByRole("button", { name: "New profile" }).first().click()
    await expect(page.getByLabel("Name")).toHaveValue("")
  })

  test("Escape, the close X and the scrim all ask when the form is dirty", async ({ page, api }) => {
    seed(api)
    await openNewProfile(page)
    await page.getByLabel("Name").fill("Draft")

    await page.keyboard.press("Escape")
    const confirm = page.getByRole("dialog", { name: "Discard changes?" })
    await expect(confirm).toBeVisible()
    await confirm.getByRole("button", { name: "Keep editing" }).click()

    await page.getByRole("button", { name: "Close", exact: true }).click()
    await expect(confirm).toBeVisible()
    await confirm.getByRole("button", { name: "Keep editing" }).click()

    await page.mouse.click(6, 6)
    await expect(confirm).toBeVisible()
    await expect(page.getByRole("dialog", { name: "New profile" })).toBeVisible()
  })

  test("a staged fallback chain is dirty work", async ({ page, api }) => {
    seed(api)
    await openNewProfile(page)
    await page.getByRole("combobox", { name: /^Engine/ }).selectOption("1")
    await page.getByRole("combobox", { name: /^Resolver/ }).selectOption("2")
    await page.getByRole("button", { name: /^Fallbacks/ }).click()
    await page.getByRole("combobox", { name: "Fallback 1 · Source" }).selectOption("1")
    await page.getByRole("button", { name: "Add fallback" }).click()

    await page.getByRole("button", { name: "Cancel" }).click()
    const confirm = page.getByRole("dialog", { name: "Discard changes?" })
    await expect(confirm).toContainText("the fallback chain")
    await expect(confirm).toContainText("them")
  })

  test("an engine pick alone is dirty, and editing opens clean", async ({ page, api }) => {
    seed(api)
    await openNewProfile(page)
    await page.getByRole("combobox", { name: /^Engine/ }).selectOption("1")

    await page.getByRole("button", { name: "Cancel" }).click()
    await expect(page.getByRole("dialog", { name: "Discard changes?" })).toContainText("the engine")
    await page.getByRole("dialog", { name: "Discard changes?" }).getByRole("button", { name: "Keep editing" }).click()
    await expect(page.getByRole("dialog", { name: "Discard changes?" })).toBeHidden()

    await page.keyboard.press("Escape")
    const second = page.getByRole("dialog", { name: "Discard changes?" })
    await expect(second).toBeVisible()
    await second.getByRole("button", { name: "Discard" }).click()

    await page.getByRole("button", { name: "Actions for F1 Weekend" }).first().click()
    await page.getByRole("menuitem", { name: "Edit" }).click()
    await expect(page.getByRole("dialog", { name: "Edit profile" })).toBeVisible()
    await page.getByRole("button", { name: "Cancel" }).click()
    await expect(page.getByRole("dialog", { name: "Discard changes?" })).toHaveCount(0)
  })
})

test.describe("catalog states", () => {
  test("a failed engine list is an error with Retry, never an empty list", async ({ page, api }) => {
    seed(api)
    api.data.failures = [{ path: /^\/engines/, status: 503, body: { detail: "engines are down" } }]
    await openNewProfile(page)

    const dialog = page.getByRole("dialog", { name: "New profile" })
    await expect(dialog.getByText("engines are down")).toBeVisible()
    await expect(dialog.getByRole("combobox", { name: /^Engine/ })).toHaveCount(0)
    await expect(dialog.getByText(/No engines are installed/)).toHaveCount(0)

    // The primary is disabled, and the reason names the list that failed.
    await expect(dialog.getByRole("button", { name: "Create profile" })).toBeDisabled()
    await expect(dialog.getByText(/engine list did not load/)).toBeVisible()

    // Retry re-reads the list and the field comes back.
    api.data.failures = []
    await dialog.getByRole("button", { name: "Retry" }).click()
    await expect(dialog.getByRole("combobox", { name: /^Engine/ })).toBeVisible()
    await expect(dialog.getByText(/engine list did not load/)).toHaveCount(0)
  })

  test("a failed resolver list blocks a source too, naming the resolvers", async ({ page, api }) => {
    seed(api)
    api.data.failures = [{ path: /^\/resolvers/, status: 500, body: { detail: "resolvers are down" } }]
    await page.goto("/profiles")
    await page.getByRole("button", { name: "New source" }).first().click()

    const dialog = page.getByRole("dialog", { name: "New source" })
    await expect(dialog.getByText("resolvers are down")).toBeVisible()
    await expect(dialog.getByRole("button", { name: "Create source" })).toBeDisabled()
    await expect(dialog.getByText(/resolver list did not load/)).toBeVisible()
  })

  test("an empty engine list says so in prose", async ({ page, api }) => {
    seed(api)
    api.data.engines = []
    await openNewProfile(page)
    await expect(page.getByText(/No engines are installed/)).toBeVisible()
  })

  test("a saved source still takes the form without a prompt after a clean save", async ({ page, api }) => {
    seed(api)
    await page.goto("/profiles")
    await page.getByRole("button", { name: "New source" }).first().click()
    await page.getByLabel("Name").fill("Sky backup")
    await page.getByRole("combobox", { name: /^Resolver/ }).selectOption("1")

    await page.getByRole("button", { name: "Create source" }).click()
    await expect(page.getByRole("dialog", { name: "New source" })).toBeHidden()
    await expect(page.getByRole("dialog", { name: "Discard changes?" })).toHaveCount(0)
    await expect.poll(() => api.callsTo("/sources/").filter((call) => call.method === "POST").length).toBe(1)
  })
})

test("the footer does not sit on the last field at 375", async ({ page, api }) => {
  seed(api)
  await page.setViewportSize(MOBILE)
  await openNewProfile(page)
  await page.getByRole("combobox", { name: /^Engine/ }).selectOption("1")
  await page.getByRole("combobox", { name: /^Resolver/ }).selectOption("1")

  const measure = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    const footer = dialog.querySelector("footer") as HTMLElement
    const body = footer.previousElementSibling as HTMLElement
    return {
      bodyBottom: body.getBoundingClientRect().bottom,
      footerTop: footer.getBoundingClientRect().top,
      clientHeight: body.clientHeight,
      scrollHeight: body.scrollHeight,
    }
  })
  expect(measure.footerTop).toBeGreaterThanOrEqual(measure.bodyBottom - 1)

  // Focus the very last control: the browser scrolls it into view inside the
  // body, and the clearance to the footer is what the eye reads as "covered".
  const last = page.getByRole("combobox", { name: /^Mode/ })
  await last.focus()
  const after = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    const footer = dialog.querySelector("footer") as HTMLElement
    const body = footer.previousElementSibling as HTMLElement
    const control = document.querySelector("#preset-profile-retry-mode")?.closest("div")?.parentElement
    const box = (control ?? document.querySelector("#preset-profile-retry-mode"))?.getBoundingClientRect()
    return {
      scrollTop: body.scrollTop,
      bodyBottom: body.getBoundingClientRect().bottom,
      footerTop: footer.getBoundingClientRect().top,
      controlBottom: box?.bottom ?? null,
      clearance: box === undefined ? null : body.getBoundingClientRect().bottom - box.bottom,
      scrollMargin: getComputedStyle(
        document.querySelector("#preset-profile-retry-mode") as HTMLElement,
      ).scrollMarginBottom,
    }
  })
  expect(after.controlBottom).not.toBeNull()
  expect(after.clearance ?? 0).toBeGreaterThanOrEqual(44)
})
