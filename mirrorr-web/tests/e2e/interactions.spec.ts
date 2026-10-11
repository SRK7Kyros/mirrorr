import { expect, profile, test } from "./fixtures"

/**
 * Overlay + keyboard interactions: Escape closes the dialog and hands focus
 * back to its trigger, the new-session form resets between openings (the
 * `openedRef` latch), and the segmented control moves with the arrow keys.
 */
const PROFILES = [profile({ id: 1, name: "F1 Weekend" }), profile({ id: 2, name: "News Hour" })]

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
})