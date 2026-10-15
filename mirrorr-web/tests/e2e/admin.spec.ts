import { expect, test } from "./fixtures"
import type { Page } from "@playwright/test"

/**
 * Admin surface (plan: admin-ownership-and-access). The console ships as a
 * second build whose entry is `admin.html`; the dev server serves that file
 * regardless of the surface flag, and the admin entry mounts the same router
 * with `AdministrationSection` contributed. Its own path is not a route, so the
 * spec steps through the not-found link and the sidebar into Settings.
 */
async function openAdminSettings(page: Page): Promise<void> {
  await page.goto("/admin.html")
  await page.getByRole("link", { name: "Back to sessions" }).click()
  await page.getByRole("link", { name: "Settings" }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible()
}

function resourcePanel(page: Page) {
  return page.locator('section:has(> header > h2:text-is("Resource access"))')
}

const USERS = [
  { id: 1, username: "kyros", role: "admin", display_name: "Kyros" },
  { id: 2, username: "alice", role: "user", display_name: "Alice" },
]

function sessionRow() {
  return {
    resource_type: "session",
    id: 7,
    label: "F1 Weekend",
    owner: "kyros",
    owner_missing: false,
    viewer_count: 0,
    system: false,
  }
}

test.describe("admin resource access", () => {
  test("lists resources and leaves system rows read-only", async ({ page, api }) => {
    api.data.users = USERS
    api.data.resources = [
      { ...sessionRow(), viewer_count: 2 },
      {
        resource_type: "engine",
        id: 1,
        label: "Streamlink",
        owner: "",
        owner_missing: false,
        viewer_count: 0,
        system: true,
      },
    ]

    await openAdminSettings(page)

    const panel = resourcePanel(page)
    await expect(panel.getByText("F1 Weekend", { exact: true })).toBeVisible()
    await expect(panel.getByText("kyros", { exact: true })).toBeVisible()
    await expect(panel.getByText("System", { exact: true })).toBeVisible()
    await expect(panel.getByRole("button", { name: "Manage access for Streamlink" })).toHaveCount(0)
    await expect(panel.getByRole("button", { name: "Manage access for F1 Weekend" })).toBeVisible()
  })

  test("reassigns an owner and adds then removes a viewer", async ({ page, api }) => {
    api.data.users = USERS
    api.data.resources = [sessionRow()]

    await openAdminSettings(page)

    await resourcePanel(page).getByRole("button", { name: "Manage access for F1 Weekend" }).click()

    await page.getByLabel("Owner", { exact: true }).selectOption("alice")
    await expect
      .poll(() => api.callsTo("/admin/resources/session/7/owner").some((call) => call.method === "PUT"))
      .toBe(true)

    await page.getByLabel("Add a viewer", { exact: true }).selectOption("alice")
    await page.getByRole("button", { name: "Add", exact: true }).click()
    await expect
      .poll(() => api.callsTo("/admin/resources/session/7/access").some((call) => call.method === "POST"))
      .toBe(true)

    await page.getByRole("button", { name: "Remove alice" }).click()
    await expect
      .poll(() => api.callsTo("/admin/resources/session/7/access/alice").some((call) => call.method === "DELETE"))
      .toBe(true)
  })
})
