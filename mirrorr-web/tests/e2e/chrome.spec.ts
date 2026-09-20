import path from "node:path"
import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"

/**
 * Todo 17 acceptance (spec L17-L23, L489-L491, L187, L398-L399, L406, L49):
 * the three chrome states (rail below 900px, 224px sidebar at ≥900px), the
 * seven nav destinations in order with active styling, the user menu logout,
 * the health banner, the two-component notification badge and the drawer.
 *
 * Destructive flows (logout) run in a throwaway context seeded from the shared
 * `storageState` FILE so the seeded admin session is never logged out; the
 * disposable user is created for this run only and deleted in `afterAll`.
 */

const API_BASE = "http://127.0.0.1:8000"
const EVIDENCE_DIR = path.resolve(import.meta.dirname, "../../../.omo/evidence")
const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const DISPOSABLE_USER = `qa-disposable-17-${RUN_ID}`
const DISPOSABLE_PASSWORD = "disposable-123"
const FRAME_EVENT = "mirrorr:notification-frame"
const API_UNREACHABLE_COPY = "API unreachable — retrying"

const NOTIFICATION_UNREAD = {
  id: 101,
  user_id: 1,
  resource_type: "recording",
  resource_id: 5,
  event_type: "recording.created",
  title: "recording 5 created",
  body: "",
  read: false,
  created_at: "2026-09-19T10:00:00",
}

const NOTIFICATION_READ = {
  id: 102,
  user_id: 1,
  resource_type: "session",
  resource_id: 9,
  event_type: "session.stopped",
  title: "session 9 stopped",
  body: "",
  read: true,
  created_at: "2026-09-19T09:00:00",
}

const RECORDING = {
  id: 5,
  user_friendly_name: "Morning capture",
  snake_case_name: "morning_capture",
  content_url: "/media/morning.m3u8",
  profile_name: null,
  engine_name: null,
  resolver_name: null,
  duration_seconds: 65,
  size_bytes: 1_048_576,
  created_at: "2026-09-19T10:00:00",
}

const SYNTHETIC_FRAME = {
  resource_type: "session",
  resource_id: 5,
  event_type: "session.crashed",
  title: "session 5: session.crashed",
  created_at: "2026-09-19T10:00:00",
}

function json(body: unknown): { status: number; contentType: string; body: string } {
  return { status: 200, contentType: "application/json", body: JSON.stringify(body) }
}

/** Answers the notification REST surface with the given rows (§11.3, §13.10.2). */
async function stubNotifications(
  page: Page,
  rows: readonly Record<string, unknown>[] = [NOTIFICATION_UNREAD, NOTIFICATION_READ],
): Promise<void> {
  await page.route("**/api/notifications/**", async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname

    if (request.method() === "GET" && pathname === "/api/notifications/") {
      await route.fulfill({ ...json(rows), headers: { "Cache-Control": "no-store" } })
      return
    }
    if (request.method() === "POST" && pathname === "/api/notifications/read-all") {
      await route.fulfill(json({ status: "all_marked_read" }))
      return
    }
    if (request.method() === "POST" && pathname.endsWith("/read")) {
      const id = Number(pathname.split("/").at(-2))
      const row = rows.find((item) => item.id === id) ?? {}
      await route.fulfill(json({ ...row, read: true }))
      return
    }
    if (request.method() === "DELETE") {
      await route.fulfill(json({ status: "deleted" }))
      return
    }
    await route.fallback()
  })
}

/** Answers `GET /api/recordings/` with one card so a drawer row can navigate to it. */
async function stubRecordingList(page: Page): Promise<void> {
  await page.route("**/api/recordings/**", async (route) => {
    const request = route.request()
    if (request.method() !== "GET" || new URL(request.url()).pathname !== "/api/recordings/") {
      await route.fallback()
      return
    }
    await route.fulfill({
      ...json({ items: [RECORDING], next_cursor: null, has_more: false }),
      headers: { "Cache-Control": "no-store" },
    })
  })
}

test.describe("chrome, user menu, health banner, notifications", () => {
  test.describe.configure({ mode: "serial" })

  let adminToken = ""

  test.beforeAll(async ({ playwright }) => {
    const api = await playwright.request.newContext()
    const response = await api.post(`${API_BASE}/auth/login`, {
      data: { username: "admin", password: "admin123" },
    })
    expect(response.ok(), "precondition: admin API login").toBeTruthy()
    const body = (await response.json()) as { access_token?: string | null }
    adminToken = body.access_token ?? ""
    expect(adminToken.length, "admin access token for cleanup").toBeGreaterThan(0)
    await api.dispose()

    // Register re-issues auth cookies, so it runs in its own throwaway context.
    const registrar = await playwright.request.newContext()
    const created = await registrar.post(`${API_BASE}/auth/register`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        username: DISPOSABLE_USER,
        password: DISPOSABLE_PASSWORD,
        display_name: "QA Disposable 17",
      },
    })
    expect(created.ok(), `created disposable user ${DISPOSABLE_USER}`).toBeTruthy()
    await registrar.dispose()
  })

  test.afterAll(async ({ playwright }) => {
    const api = await playwright.request.newContext()
    const response = await api.delete(`${API_BASE}/auth/users/${DISPOSABLE_USER}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    const cleanup = response.ok() || response.status() === 404 ? "deleted" : `failed:${response.status()}`
    await api.dispose()

    const fs = await import("node:fs/promises")
    await fs.mkdir(EVIDENCE_DIR, { recursive: true })
    await fs.writeFile(
      path.join(EVIDENCE_DIR, "task-17-run-receipt.json"),
      JSON.stringify(
        {
          runId: RUN_ID,
          disposableUser: DISPOSABLE_USER,
          cleanup,
          realLoginPosts: [
            "POST /auth/login admin (beforeAll, API token for cleanup)",
            "POST /auth/login disposable user (UI logout test)",
          ],
        },
        null,
        2,
      ),
    )
  })

  test("chrome states: 56px rail at 800x900, 224px sidebar with the active item styling at 1280", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 900 })
    await page.goto("/sessions")

    const sidebar = page.getByTestId("sidebar")
    await expect(sidebar).toBeVisible()
    const rail = await sidebar.boundingBox()
    expect(Math.round(rail?.width ?? 0), "below 900px the sidebar is a 56px icon rail").toBe(56)
    const topBar = await page.getByTestId("top-bar").boundingBox()
    expect(Math.round(topBar?.height ?? 0), "top bar is 48px").toBe(48)

    const nav = page.getByRole("navigation", { name: "Primary" })
    await expect(nav.getByRole("link")).toHaveCount(7)
    const labels = await nav
      .getByRole("link")
      .evaluateAll((elements) => elements.map((element) => element.textContent?.trim()))
    expect(labels).toEqual([
      "Sessions",
      "Autoruns",
      "Recordings",
      "Profiles",
      "Plugins",
      "Import/Export",
      "Settings",
    ])

    const dot = page.getByTestId("connection-dot")
    await expect(dot).toHaveAttribute("role", "status")
    await expect(dot).toContainText(/Live|Reconnecting|Polling/)

    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-17-rail-800x900.png") })

    await page.setViewportSize({ width: 1280, height: 900 })
    await expect
      .poll(async () => Math.round((await sidebar.boundingBox())?.width ?? 0), {
        message: "at 1280px the sidebar is 224px",
      })
      .toBe(224)

    const active = nav.getByRole("link", { name: "Sessions" })
    await expect(active).toHaveAttribute("aria-current", "page")
    const bar = await active.getByTestId("nav-active-bar").boundingBox()
    expect(Math.round(bar?.width ?? 0), "active item shows the 2px accent left bar").toBe(2)
    const background = await active.evaluate((element) => getComputedStyle(element).backgroundColor)
    expect(background, "active item shows the overlay background").not.toBe("rgba(0, 0, 0, 0)")

    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-17-desktop-chrome-1280.png") })
  })

  test("failure: the same synthetic frame twice for one tuple increments the badge once", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 })
    await stubNotifications(page, [])
    await page.goto("/sessions")

    const bell = page.getByTestId("notification-bell")
    await expect(bell).toHaveAttribute("aria-label", "0 unread notifications")

    const dispatchFrame = () =>
      page.evaluate(
        ({ event, detail }) => {
          window.dispatchEvent(new CustomEvent(event, { detail }))
        },
        { event: FRAME_EVENT, detail: SYNTHETIC_FRAME },
      )

    await dispatchFrame()
    await expect(bell).toHaveAttribute("aria-label", "1 unread notifications")

    await dispatchFrame()
    await expect(bell).toHaveAttribute("aria-label", "1 unread notifications")

    await bell.click()
    const drawer = page.getByRole("dialog", { name: "Notifications" })
    await expect(drawer).toBeVisible()
    // Opening the drawer acknowledges nothing: the synthetic component survives.
    await expect(bell).toHaveAttribute("aria-label", "1 unread notifications")

    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-17-bell-rail-800x900.png") })
    await page.keyboard.press("Escape")
    await expect(drawer).toHaveCount(0)
  })

  test("navigation: a stubbed REST recording row lands on /recordings?highlight=5 with the 2s ring and drops the badge", async ({
    page,
  }) => {
    await stubNotifications(page)
    await stubRecordingList(page)
    await page.goto("/sessions")

    const bell = page.getByTestId("notification-bell")
    await expect(bell).toHaveAttribute("aria-label", "1 unread notifications")

    await bell.click()
    await page
      .getByRole("dialog", { name: "Notifications" })
      .getByTestId("notification-open-101")
      .click()

    await expect(page).toHaveURL(/\/recordings\?highlight=5$/)
    const card = page.getByTestId("recording-card-5")
    await expect(card).toHaveAttribute("data-highlighted", "true", { timeout: 2000 })
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-17-recording-highlight.png") })

    await expect(bell).toHaveAttribute("aria-label", "0 unread notifications")
    await expect(card).not.toHaveAttribute("data-highlighted", "true", { timeout: 5000 })
  })

  test("health banner: /health failure shows 'API unreachable — retrying' and Retry clears it", async ({
    page,
  }) => {
    let healthy = false
    await page.route("**/api/health", async (route) => {
      await route.fulfill(
        healthy
          ? json({ status: "ok" })
          : { status: 503, contentType: "application/json", body: JSON.stringify({ detail: "down" }) },
      )
    })

    await page.goto("/sessions")
    await expect(page.getByText(API_UNREACHABLE_COPY)).toBeVisible()
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-17-health-banner.png") })

    healthy = true
    await page.getByRole("button", { name: "Retry" }).click()
    await expect(page.getByText(API_UNREACHABLE_COPY)).toHaveCount(0)
  })

  test("logout: the disposable user signs out and a guarded route redirects to /login with no stale rows", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      viewport: { width: 800, height: 900 },
    })
    const page = await context.newPage()

    await page.goto("/login")
    await page.getByLabel("Username").fill(DISPOSABLE_USER)
    await page.getByLabel("Password", { exact: true }).fill(DISPOSABLE_PASSWORD)
    await page.getByRole("button", { name: "Sign in" }).click()
    await expect(page).toHaveURL(/\/sessions$/)
    await expect(page.getByTestId("sessions-view")).toBeVisible()

    await page.getByTestId("user-menu-button").click()
    await expect(page.getByTestId("user-menu")).toBeVisible()
    await page.getByRole("menuitem", { name: "Log out" }).click()

    await expect(page).toHaveURL(/\/login/)
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-17-logout-800x900.png") })

    await page.goto("/sessions")
    await expect(page).toHaveURL(/\/login\?redirect=/)
    await expect(page.getByTestId("sessions-view")).toHaveCount(0)

    await context.close()
  })

  test("the shared storageState session is still valid after the disposable logout", async ({ page }) => {
    await page.goto("/sessions")
    await expect(page).toHaveURL(/\/sessions$/)
    await expect(page.getByTestId("sessions-view")).toBeVisible()
  })
})
