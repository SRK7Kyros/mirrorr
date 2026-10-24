import { expect, test } from "./fixtures"

test.describe("app shell", () => {
  test("an anonymous visitor is redirected to the login screen", async ({ page, api }) => {
    api.data.authenticated = false

    await page.goto("/sessions")

    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByLabel("Username")).toBeVisible()
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible()
    // Once users exist the login screen must still route people to /register —
    // that page files a registration request an admin approves.
    await expect(page.getByRole("link", { name: "Request access" })).toHaveAttribute("href", "/register")
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

  test("an admin can reach the admin console from settings", async ({ page }) => {
    await page.goto("/settings")

    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible()
    // The admin console (registration queue, users, clients) is a second build;
    // this link is its only door — without it the queue is unreachable.
    await expect(page.getByRole("link", { name: "Open console" })).toHaveAttribute("href", "/admin/settings")
  })

  test("the chrome takes its insets from the safe-area variables", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto("/sessions")

    const header = page.locator("header").first()
    const shell = page.locator("div.min-h-dvh").first()
    const sidebar = page.locator("aside").first()
    const measure = async (): Promise<Record<string, number>> => ({
      header: await header.evaluate((el) => el.getBoundingClientRect().height),
      shellLeft: await shell.evaluate((el) => Number.parseFloat(getComputedStyle(el).paddingLeft)),
      shellRight: await shell.evaluate((el) => Number.parseFloat(getComputedStyle(el).paddingRight)),
      sidebarTop: await sidebar.evaluate((el) => Number.parseFloat(getComputedStyle(el).paddingTop)),
    })

    const before = await measure()
    const installed = await page.evaluate(() =>
      ["top", "right", "bottom", "left"].map((edge) =>
        document.documentElement.style.getPropertyValue(`--safe-${edge}`),
      ),
    )
    expect(installed).toEqual(["0px", "0px", "0px", "0px"])

    await page.evaluate(() => {
      const root = document.documentElement
      root.style.setProperty("--safe-top", "47px")
      root.style.setProperty("--safe-left", "33px")
      root.style.setProperty("--safe-right", "21px")
    })
    const after = await measure()

    expect(after.header - before.header).toBe(47)
    expect(after.sidebarTop - before.sidebarTop).toBe(47)
    expect(after.shellLeft - before.shellLeft).toBe(33)
    expect(after.shellRight - before.shellRight).toBe(21)
  })
})
