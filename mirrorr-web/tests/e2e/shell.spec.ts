import { expect, test } from "./fixtures"

test.describe("app shell", () => {
  test("an anonymous visitor is redirected to the login screen", async ({ page, api }) => {
    api.data.authenticated = false

    await page.goto("/sessions")

    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByLabel("Username")).toBeVisible()
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible()
  })

  test("an authenticated visitor lands on sessions", async ({ page }) => {
    await page.goto("/")

    await expect(page).toHaveURL(/\/sessions$/)
    await expect(page.getByRole("heading", { level: 1, name: "Sessions" })).toBeVisible()
  })

  test("an unknown path renders the not-found view", async ({ page }) => {
    await page.goto("/definitely-not-a-route")

    await expect(page.getByRole("heading", { level: 1, name: "Not found" })).toBeVisible()
    await expect(page.getByText("This page does not exist")).toBeVisible()
  })
})
