import path from "node:path"
import type { WebSocketRoute } from "@playwright/test"
import { expect, test } from "./fixtures"
import { STORAGE_STATE } from "../../playwright.config"

/**
 * Todo 16 acceptance (plan: "Build the settings surfaces"):
 * V11 account (user card, change-password, notification preferences),
 * V12 admin users (create via `POST /auth/register`, typed delete, last-admin
 * guard), V13 admin API clients (explainer banner, one-time key reveal, typed
 * revoke). Admin flows reuse the shared `storageState`; destructive flows run
 * in throwaway contexts so the seeded admin session is never logged out.
 */

const API_BASE = "http://127.0.0.1:8000"
const EVIDENCE_DIR = path.resolve(import.meta.dirname, "../../../.omo/evidence")
const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const DISPOSABLE_USER = `qa-disposable-16-${RUN_ID}`
const DISPOSABLE_PASSWORD = "disposable-123"
const DISPOSABLE_NEW_PASSWORD = "disposable-456"
const CREATED_USER = `qa-e2e16-user-${RUN_ID}`
const CREATED_CLIENT = `qa-e2e16-client-${RUN_ID}`
const PASSWORD_CHANGED_TOAST = "Password changed — sign in again"
const LAST_ADMIN_TOOLTIP = "Cannot delete the last admin"
const API_CLIENTS_BANNER =
  "Programmatic access keys — treat like passwords. Keys act as a non-human principal; resources they create belong to no user and fire no notifications."
const PREFS_STORAGE_KEY = "mirrorr.notification-prefs"

interface CreatedClientRow {
  readonly id: number
  readonly name: string
}

test.describe("settings surfaces (V11-V13)", () => {
  test.describe.configure({ mode: "serial" })

  let adminToken = ""
  let createdClientId: number | null = null

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

    // Register re-issues auth cookies, so the disposable-user call runs in its
    // own request context that is thrown away afterwards.
    const registrar = await playwright.request.newContext()
    const created = await registrar.post(`${API_BASE}/auth/register`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        username: DISPOSABLE_USER,
        password: DISPOSABLE_PASSWORD,
        display_name: "QA Disposable 16",
      },
    })
    expect(created.ok(), `created disposable user ${DISPOSABLE_USER}`).toBeTruthy()
    await registrar.dispose()
  })

  test.afterAll(async ({ playwright }) => {
    const api = await playwright.request.newContext()
    const auth = { Authorization: `Bearer ${adminToken}` }
    const deleted: string[] = []
    for (const username of [CREATED_USER, DISPOSABLE_USER]) {
      const response = await api.delete(`${API_BASE}/auth/users/${username}`, { headers: auth })
      if (response.ok() || response.status() === 404) deleted.push(username)
    }
    const clients = await api.get(`${API_BASE}/auth/clients`, { headers: auth })
    if (clients.ok()) {
      const rows = (await clients.json()) as CreatedClientRow[]
      for (const row of rows) {
        if (row.name === CREATED_CLIENT) {
          await api.delete(`${API_BASE}/auth/clients/${row.id}`, { headers: auth })
        }
      }
    }
    await api.dispose()

    const fs = await import("node:fs/promises")
    await fs.mkdir(EVIDENCE_DIR, { recursive: true })
    await fs.writeFile(
      path.join(EVIDENCE_DIR, "task-16-run-receipt.json"),
      JSON.stringify(
        {
          runId: RUN_ID,
          disposableUser: DISPOSABLE_USER,
          createdUser: CREATED_USER,
          createdClient: CREATED_CLIENT,
          createdClientId,
          deletedUsers: deleted,
        },
        null,
        2,
      ),
    )
  })

  test("V11 shows the user card for the signed-in admin", async ({ page }) => {
    await page.goto("/settings")
    const card = page.getByTestId("settings-user-card")
    await expect(card).toBeVisible()
    await expect(page.getByTestId("user-card-username")).toHaveText("admin")
    await expect(page.getByTestId("user-card-display-name")).toHaveText("Admin")
    await expect(card.getByTestId("role-badge")).toHaveText("Administrator")
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-16-v11-account.png") })
  })

  test("V11 notification preferences persist to localStorage and gate toasts", async ({ page }) => {
    const notificationRoutes: WebSocketRoute[] = []
    await page.routeWebSocket("**/ws/**", (ws) => {
      if (ws.url().endsWith("/ws/notifications")) notificationRoutes.push(ws)
    })
    const pushCrash = async (title: string, minimumRoutes: number) => {
      await expect.poll(() => notificationRoutes.length).toBeGreaterThanOrEqual(minimumRoutes)
      notificationRoutes
        .at(-1)
        ?.send(
          JSON.stringify({
            type: "notification",
            data: { resource_type: "session", resource_id: 7, event_type: "session.crashed", title },
          }),
        )
    }

    await page.goto("/settings")
    const crashes = page.getByRole("switch", { name: "Crashes" })
    const completions = page.getByRole("switch", { name: "Completions" })
    const recordings = page.getByRole("switch", { name: "Recordings" })
    await expect(crashes).toHaveAttribute("aria-checked", "true")

    await crashes.click()
    await completions.click()
    await recordings.click()
    const stored = await page.evaluate((key) => window.localStorage.getItem(key), PREFS_STORAGE_KEY)
    expect(stored).not.toBeNull()
    expect(JSON.parse(String(stored))).toEqual({ crashes: false, completions: false, recordings: false })

    await page.reload()
    await expect(page.getByRole("switch", { name: "Crashes" })).toHaveAttribute("aria-checked", "false")
    await expect(page.getByRole("switch", { name: "Completions" })).toHaveAttribute("aria-checked", "false")
    await expect(page.getByRole("switch", { name: "Recordings" })).toHaveAttribute("aria-checked", "false")

    await pushCrash("E2E crash A", 2)
    await expect(page.getByText("E2E crash A")).toBeHidden()

    await page.getByRole("switch", { name: "Crashes" }).click()
    await page.reload()
    await pushCrash("E2E crash B", 3)
    await expect(page.getByTestId("toast").filter({ hasText: "E2E crash B" })).toBeVisible()
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-16-preferences-toast.png") })
  })

  test("V12 creates a user through the admin register path and deletes it with typed confirmation", async ({
    browser,
    page,
  }) => {
    const throwaway = await browser.newContext({ storageState: STORAGE_STATE })
    const throwawayPage = await throwaway.newPage()
    await throwawayPage.goto("/settings/users")
    await throwawayPage.getByRole("button", { name: "New user" }).click()
    await throwawayPage.getByLabel("Username").fill(CREATED_USER)
    await throwawayPage.getByLabel("Display name").fill("QA E2E User")
    await throwawayPage.getByLabel("Password").fill("e2e-password-123")
    await throwawayPage.getByRole("button", { name: "Create user" }).click()
    await expect(throwawayPage.getByTestId("toast").filter({ hasText: CREATED_USER })).toBeVisible()
    await throwaway.close()

    await page.goto("/settings/users")
    const row = page.getByTestId("table-row").filter({ hasText: CREATED_USER })
    await expect(row).toBeVisible()
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-16-v12-users.png") })

    await row.getByRole("button", { name: "Delete" }).click()
    const confirm = page.getByRole("button", { name: "Delete user" })
    await expect(confirm).toBeDisabled()
    await page.getByLabel(`Type ${CREATED_USER} to confirm`).fill(CREATED_USER)
    await expect(confirm).toBeEnabled()
    await confirm.click()
    await expect(page.getByTestId("table-row").filter({ hasText: CREATED_USER })).toBeHidden()
  })

  test("V12 disables delete with a tooltip when only the last admin remains", async ({ page }) => {
    await page.goto("/settings/users")
    const adminRow = page.getByTestId("table-row").filter({ hasText: "admin" })
    const deleteButton = adminRow.getByRole("button", { name: "Delete" })
    await expect(deleteButton).toBeDisabled()
    await expect(deleteButton).toHaveAttribute("title", LAST_ADMIN_TOOLTIP)
  })

  test("V13 creates an API client, reveals the key once and revokes it with typed confirmation", async ({
    page,
    playwright,
  }) => {
    await page.goto("/settings/clients")
    await expect(page.getByTestId("api-clients-banner")).toHaveText(API_CLIENTS_BANNER)

    await page.getByRole("button", { name: "New key" }).click()
    await page.getByLabel("Name").fill(CREATED_CLIENT)
    await page.getByRole("button", { name: "Create key" }).click()

    const reveal = page.getByTestId("api-key-reveal")
    await expect(reveal).toBeVisible()
    await expect(reveal.getByText("Shown once — store it now")).toBeVisible()
    const key = await page.getByTestId("api-key-value").textContent()
    expect(String(key).length).toBeGreaterThan(16)
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-16-v13-clients.png") })

    const clientsApi = await playwright.request.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${adminToken}` },
    })
    const clientsResponse = await clientsApi.get(`${API_BASE}/auth/clients`)
    const rows = (await clientsResponse.json()) as Array<CreatedClientRow & { api_key_hash?: string }>
    const created = rows.find((row) => row.name === CREATED_CLIENT)
    expect(created, "created client is listed by the core").toBeTruthy()
    createdClientId = created?.id ?? null
    expect(JSON.stringify(rows)).not.toContain(String(key))
    await clientsApi.dispose()

    await page.getByRole("button", { name: "I've saved it" }).click()
    await expect(reveal).toBeHidden()
    await page.reload()
    await expect(page.getByTestId("api-key-reveal")).toBeHidden()
    expect(await page.locator("body").innerText()).not.toContain(String(key))
    await expect(page.getByTestId("table-row").filter({ hasText: CREATED_CLIENT })).toBeVisible()

    const createdRow = page.getByTestId("table-row").filter({ hasText: CREATED_CLIENT })
    await createdRow.getByRole("button", { name: "Revoke" }).click()
    const revoke = page.getByRole("button", { name: "Revoke key" })
    await expect(revoke).toBeDisabled()
    await page.getByLabel(`Type ${CREATED_CLIENT} to confirm`).fill(CREATED_CLIENT)
    await expect(revoke).toBeEnabled()
    await revoke.click()
    await expect(page.getByTestId("table-row").filter({ hasText: CREATED_CLIENT })).toBeHidden()
  })

  test("a non-admin is redirected away from both admin settings surfaces", async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto("/login")
    await page.getByLabel("Username").fill(DISPOSABLE_USER)
    await page.getByLabel("Password").fill(DISPOSABLE_PASSWORD)
    await page.getByRole("button", { name: "Sign in" }).click()
    await expect(page).toHaveURL(/\/sessions$/)

    await page.goto("/settings/users")
    await expect(page).toHaveURL(/\/settings$/)
    await expect(page.getByTestId("settings-users-view")).toBeHidden()
    await expect(page.getByTestId("settings-view")).toBeVisible()

    await page.goto("/settings/clients")
    await expect(page).toHaveURL(/\/settings$/)
    await expect(page.getByTestId("settings-clients-view")).toBeHidden()
    await context.close()
  })

  test("change-password rejects a wrong old password and then forces a logout", async ({ browser }) => {
    const context = await browser.newContext({ storageState: STORAGE_STATE })
    const page = await context.newPage()
    await context.clearCookies()
    await page.goto("/login")
    await page.getByLabel("Username").fill(DISPOSABLE_USER)
    await page.getByLabel("Password").fill(DISPOSABLE_PASSWORD)
    await page.getByRole("button", { name: "Sign in" }).click()
    await expect(page).toHaveURL(/\/sessions$/)

    await page.goto("/settings")
    await page.getByLabel("Old password", { exact: true }).fill("wrong-password")
    await page.getByLabel("New password", { exact: true }).fill(DISPOSABLE_NEW_PASSWORD)
    await page.getByLabel("Confirm new password").fill(DISPOSABLE_NEW_PASSWORD)
    await page.getByRole("button", { name: "Change password" }).click()
    await expect(page.getByText("Invalid current password")).toBeVisible()
    await expect(page).toHaveURL(/\/settings$/)
    await expect(page.getByTestId("settings-user-card")).toBeVisible()
    await expect(page.getByText(PASSWORD_CHANGED_TOAST)).toBeHidden()

    await page.getByLabel("Old password", { exact: true }).fill(DISPOSABLE_PASSWORD)
    await page.getByRole("button", { name: "Change password" }).click()
    await expect(page.getByTestId("toast").filter({ hasText: PASSWORD_CHANGED_TOAST })).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-16-change-password-toast.png") })
    await context.close()
  })
})
