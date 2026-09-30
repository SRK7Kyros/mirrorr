import { mkdirSync } from "node:fs"
import path from "node:path"
import { expect, test, stubCatalogs, stubSessionList, type SessionSeed } from "./fixtures"

/**
 * Todo 26 acceptance / spec L539-L551: the 13 views at 390x844. Each view must
 * render its compact presentation and — the plan's stated failure scenario —
 * no view may show a horizontally scrolling table on compact.
 */
const EVIDENCE_DIR = path.resolve(import.meta.dirname, "../../../.omo/evidence")

const SESSION_SEED: readonly SessionSeed[] = [
  {
    id: 701,
    status: "active",
    engine_id: 1,
    resolver_id: 1,
    profile_id: 9,
    recording: false,
    started_at: "2026-09-19T10:00:00",
    ended_at: null,
  },
]

const AUTORUN_ROW = {
  id: 811,
  status: "scheduled",
  user_friendly_name: "Evening news",
  snake_case_name: "evening_news",
  engine_id: 1,
  resolver_id: 1,
  start_time: "2026-09-21T10:00:00",
  end_time: "2026-09-21T11:00:00",
  recording: false,
}

test.describe("V1-V13 compact walk at 390x844", () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test("every authenticated view presents without a horizontally scrolling table", async ({ page }) => {
    test.setTimeout(120_000)
    mkdirSync(EVIDENCE_DIR, { recursive: true })
    await stubSessionList(page, SESSION_SEED)
    await stubCatalogs(page)
    await page.route("**/api/sessions/701", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Cache-Control": "no-store" },
        body: JSON.stringify({ ...SESSION_SEED[0], session_urls: [] }),
      })
    })
    await page.route("**/api/autoruns/**", async (route) => {
      const request = route.request()
      if (request.method() !== "GET") {
        await route.fallback()
        return
      }
      const pathname = new URL(request.url()).pathname
      if (pathname === "/api/autoruns/") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "Cache-Control": "no-store" },
          body: JSON.stringify({ items: [AUTORUN_ROW], next_cursor: null, has_more: false }),
        })
        return
      }
      if (pathname === "/api/autoruns/811") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "Cache-Control": "no-store" },
          body: JSON.stringify(AUTORUN_ROW),
        })
        return
      }
      await route.fallback()
    })

    const views = [
      { id: "V3", path: "/sessions", anchor: "sessions-view" },
      { id: "V4", path: "/sessions/701", anchor: "session-detail" },
      { id: "V5", path: "/autoruns", anchor: "autoruns-view" },
      { id: "V6", path: "/autoruns/811", anchor: "autorun-detail" },
      { id: "V7", path: "/recordings", anchor: "recordings-view" },
      { id: "V8", path: "/profiles", anchor: "profiles-view" },
      { id: "V9", path: "/plugins", anchor: "plugins-view" },
      { id: "V10", path: "/import-export", anchor: "import-export-view" },
      { id: "V11", path: "/settings", anchor: "settings-view" },
      { id: "V12", path: "/settings/users", anchor: "settings-users-view" },
      { id: "V13", path: "/settings/clients", anchor: "settings-clients-view" },
    ] as const

    for (const view of views) {
      await page.goto(view.path)
      await expect(page.getByTestId(view.anchor), `${view.id} renders`).toBeVisible()
      await expect(page.locator("table"), `${view.id} shows no table on compact`).toHaveCount(0)
      await expect(page.getByTestId("compact-app-bar"), `${view.id} keeps the compact app bar`).toBeVisible()
      await expect(page.getByTestId("compact-tab-bar"), `${view.id} keeps the tab bar`).toBeVisible()
      await page.screenshot({ path: path.join(EVIDENCE_DIR, `task-26-walk-${view.id}-390x844.png`) })
    }
  })
})

test.describe("V1-V2 public auth views at 390x844", () => {
  test.use({ viewport: { width: 390, height: 844 }, storageState: { cookies: [], origins: [] } })

  test("login and register render without compact chrome and without a table", async ({ page }) => {
    mkdirSync(EVIDENCE_DIR, { recursive: true })
    // V2 boots only while the core reports no users; every other outcome redirects to /login.
    await page.route("**/api/auth/status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Cache-Control": "no-store" },
        body: JSON.stringify({ has_users: false }),
      })
    })

    for (const view of [
      { id: "V1", path: "/login", anchor: "login-form" },
      { id: "V2", path: "/register", anchor: "register-form" },
    ] as const) {
      await page.goto(view.path)
      await expect(page.getByTestId(view.anchor), `${view.id} renders`).toBeVisible()
      await expect(page.locator("table"), `${view.id} shows no table on compact`).toHaveCount(0)
      await expect(page.getByTestId("compact-tab-bar"), `${view.id} has no compact chrome`).toHaveCount(0)
      await page.screenshot({ path: path.join(EVIDENCE_DIR, `task-26-walk-${view.id}-390x844.png`) })
    }
  })
})

test.describe("compact override table at 390x844", () => {
  test.use({ viewport: { width: 390, height: 844 }, storageState: { cookies: [], origins: [] } })

  test("form inputs step to 16px and toasts present top-centre", async ({ page }) => {
    await page.route("**/api/auth/status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Cache-Control": "no-store" },
        body: JSON.stringify({ has_users: false }),
      })
    })

    await page.goto("/register")
    const username = page.locator("#register-username")
    await expect(username).toBeVisible()
    expect(await username.evaluate((node) => getComputedStyle(node).fontSize)).toBe("16px")

    await page.route("**/api/auth/register", (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        headers: { "Cache-Control": "no-store" },
        body: JSON.stringify({ detail: "Too many requests" }),
      }),
    )

    await username.fill("qa-walk")
    await page.locator("#register-password").fill("supersecret123")
    await page.locator("#register-confirm-password").fill("supersecret123")
    await page.getByRole("button", { name: "Create admin account" }).click()

    await expect(page.getByTestId("toast-viewport")).toBeVisible()
    const toastBox = await page.getByTestId("toast").boundingBox()
    expect(toastBox).not.toBeNull()
    expect(Math.round(toastBox?.y ?? -1)).toBeLessThan(200)
    expect(Math.abs(Math.round((toastBox?.x ?? 0) + (toastBox?.width ?? 0) / 2) - 195)).toBeLessThanOrEqual(24)

    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-26-walk-toast-input-390x844.png") })
  })
})
