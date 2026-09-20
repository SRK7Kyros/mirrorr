import path from "node:path"
import { expect, test } from "./fixtures"

/**
 * Todo 24 — the compact shell (spec L489-L501). A 390x844 mobile viewport is
 * explicit here; the desktop/config projects are never retargeted. The spec
 * covers: the shell at 390x844 (44px app bar, 56px tab bar with five slots and
 * `aria-current`, the route-mapped FAB), the one scroll container (16px
 * padding, hidden horizontal overflow), the More sheet, and back semantics —
 * a sheet consumes the first back, the next back runs `router.history.back()`.
 * A width >= 640px must render none of it.
 */

const EVIDENCE_DIR = path.resolve(import.meta.dirname, "../../../.omo/evidence")

const LOGIN_PATH = "/auth/login"

function collectLoginPosts(page: import("@playwright/test").Page): string[] {
  const posts: string[] = []
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith(LOGIN_PATH)) {
      posts.push(request.url())
    }
  })
  return posts
}

test.describe("compact shell at 390x844", () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test("renders the compact shell with one scroll container and no desktop chrome", async ({ page }) => {
    const loginPosts = collectLoginPosts(page)
    await page.goto("/sessions")
    await expect(page.getByTestId("sessions-view")).toBeVisible()

    const appBar = page.getByTestId("compact-app-bar")
    await expect(appBar).toBeVisible()
    expect((await appBar.boundingBox())?.height).toBe(44)
    await expect(appBar.getByTestId("view-title")).toHaveText("Sessions")
    await expect(appBar.getByTestId("compact-mark")).toBeVisible()
    await expect(appBar.getByTestId("compact-back")).toHaveCount(0)
    await expect(appBar.getByTestId("compact-bell")).toBeVisible()

    const tabBar = page.getByTestId("compact-tab-bar")
    await expect(tabBar).toBeVisible()
    expect(await tabBar.evaluate((element) => getComputedStyle(element).height)).toBe("56px")
    await expect(tabBar.locator('[data-testid^="compact-tab-"]')).toHaveCount(5)
    await expect(page.getByTestId("compact-tab-sessions")).toHaveAttribute("aria-current", "page")

    await expect(page.getByTestId("sidebar")).toHaveCount(0)
    await expect(page.getByTestId("top-bar")).toHaveCount(0)

    const scroll = page.getByTestId("compact-scroll")
    await expect(scroll).toHaveCount(1)
    const scrollStyles = await scroll.evaluate((element) => {
      const styles = getComputedStyle(element)
      return {
        paddingLeft: styles.paddingLeft,
        overflowX: styles.overflowX,
        overflowY: styles.overflowY,
      }
    })
    expect(scrollStyles).toEqual({ paddingLeft: "16px", overflowX: "hidden", overflowY: "auto" })

    for (const testId of ["compact-tab-sessions", "compact-tab-more", "notification-bell"]) {
      const box = await page.getByTestId(testId).boundingBox()
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
    }

    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-24-compact-shell-390x844.png") })
    expect(loginPosts).toEqual([])

    await page.setViewportSize({ width: 639, height: 844 })
    await expect(page.getByTestId("compact-tab-bar")).toBeVisible()
  })

  test("moves aria-current when another tab is pressed and highlights More on a deep link", async ({ page }) => {
    await page.goto("/sessions")
    await page.getByTestId("compact-tab-autoruns").click()
    await expect(page).toHaveURL(/\/autoruns$/)
    await expect(page.getByTestId("compact-tab-autoruns")).toHaveAttribute("aria-current", "page")
    await expect(page.getByTestId("compact-tab-sessions")).not.toHaveAttribute("aria-current", "page")
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-24-tab-active-390x844.png") })

    await page.goto("/settings/clients")
    await expect(page.getByTestId("settings-clients-view")).toBeVisible()
    await expect(page.getByTestId("compact-tab-more")).toHaveAttribute("aria-current", "page")
    await expect(page.getByTestId("compact-back")).toBeVisible()
    const backBox = await page.getByTestId("compact-back").boundingBox()
    expect(backBox?.width).toBe(44)
    expect(backBox?.height).toBe(44)
  })

  test("lists the More destinations and account rows", async ({ page }) => {
    await page.goto("/sessions")
    await page.getByTestId("compact-tab-more").click()

    const sheet = page.getByTestId("compact-more-sheet")
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole("link", { name: "Plugins" })).toHaveAttribute("href", "/plugins")
    await expect(sheet.getByRole("link", { name: "Import/Export" })).toHaveAttribute("href", "/import-export")
    await expect(sheet.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings")
    await expect(sheet.getByRole("link", { name: "Users" })).toHaveAttribute("href", "/settings/users")
    await expect(sheet.getByRole("link", { name: "API clients" })).toHaveAttribute("href", "/settings/clients")
    await expect(sheet.getByText("admin")).toBeVisible()
    await expect(sheet.getByRole("button", { name: "Log out" })).toBeVisible()

    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-24-more-sheet-390x844.png") })
  })

  test("renders the FAB per the view rules", async ({ page }) => {
    await page.goto("/sessions")
    const fab = page.getByTestId("compact-fab")
    await expect(fab).toBeVisible()
    await expect(fab).toHaveAttribute("aria-label", "New session")
    await fab.focus()
    await expect(fab).toBeFocused()

    const box = await fab.boundingBox()
    expect(box?.width).toBe(56)
    expect(box?.height).toBe(56)
    expect(Math.round(844 - ((box?.y ?? 0) + (box?.height ?? 0)))).toBe(72)
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-24-fab-390x844.png") })

    await page.goto("/plugins")
    await expect(page.getByTestId("plugins-view")).toBeVisible()
    await expect(page.getByTestId("compact-fab")).toHaveCount(0)
    await expect(page.getByTestId("compact-primary-action")).toHaveCount(0)
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-24-fab-absent-plugins-390x844.png") })
  })

  test("a sheet consumes the first back and the second back navigates", async ({ page }) => {
    await page.goto("/sessions")
    await page.getByTestId("compact-tab-autoruns").click()
    await expect(page).toHaveURL(/\/autoruns$/)

    await page.getByTestId("compact-tab-more").click()
    await expect(page.getByTestId("compact-more-sheet")).toBeVisible()

    await page.evaluate(() => window.dispatchEvent(new Event("mirrorr:back")))
    await expect(page.getByTestId("compact-more-sheet")).toHaveCount(0)
    await expect(page).toHaveURL(/\/autoruns$/)

    await page.evaluate(() => window.dispatchEvent(new Event("mirrorr:back")))
    await expect(page).toHaveURL(/\/sessions$/)
  })

  test("the app-bar chevron on a nested route calls router.history.back()", async ({ page }) => {
    await page.goto("/sessions")
    await page.getByTestId("compact-tab-more").click()
    await page.getByTestId("compact-more-sheet").getByRole("link", { name: "Users" }).click()
    await expect(page).toHaveURL(/\/settings\/users$/)
    await expect(page.getByTestId("settings-users-view")).toBeVisible()

    await page.getByTestId("compact-back").click()
    await expect(page).toHaveURL(/\/sessions$/)
    await expect(page.getByTestId("compact-mark")).toBeVisible()
  })
})

test.describe("desktop chrome at 640px and above", () => {
  test.use({ viewport: { width: 800, height: 900 } })

  test("does not render the compact shell at 800x900 or 1280x800", async ({ page }) => {
    await page.goto("/sessions")
    await expect(page.getByTestId("sessions-view")).toBeVisible()

    const sidebar = page.getByTestId("sidebar")
    await expect(sidebar).toBeVisible()
    expect((await sidebar.boundingBox())?.width).toBe(56)
    await expect(page.getByTestId("top-bar")).toBeVisible()
    await expect(page.getByTestId("compact-app-bar")).toHaveCount(0)
    await expect(page.getByTestId("compact-tab-bar")).toHaveCount(0)
    await expect(page.getByTestId("compact-fab")).toHaveCount(0)
    await expect(page.getByTestId("compact-scroll")).toHaveCount(0)
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-24-rail-800x900.png") })

    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(sidebar).toBeVisible()
    expect((await sidebar.boundingBox())?.width).toBe(224)
    await expect(page.getByTestId("compact-tab-bar")).toHaveCount(0)
    await expect(page.getByTestId("compact-app-bar")).toHaveCount(0)
    await expect(page.getByTestId("compact-fab")).toHaveCount(0)
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-24-desktop-1280x800.png") })

    await page.setViewportSize({ width: 640, height: 900 })
    await expect(page.getByTestId("compact-tab-bar")).toHaveCount(0)
    await expect(page.getByTestId("compact-app-bar")).toHaveCount(0)
    await expect(sidebar).toBeVisible()
  })
})
