import { autorun, expect, profile, session, source, test } from "./fixtures"
import type { Page } from "@playwright/test"

/**
 * Admin surface (plans: admin-ownership-and-access, element-access-and-bulk-perms).
 * The console ships as a second build whose entry is `admin.html`; the dev server
 * serves that file regardless of the surface flag, and the admin entry mounts the
 * same router with the administration section contributed and the access slot
 * provided. Its own path is not a route, so the spec steps through the not-found
 * link and the sidebar into the list it wants.
 */
async function openAdmin(page: Page): Promise<void> {
  await page.goto("/admin.html")
  await page.getByRole("link", { name: "Back to sessions" }).click()
}

async function openNav(page: Page, label: string): Promise<void> {
  await page.getByRole("link", { name: label, exact: true }).first().click()
}

async function openAdminSettings(page: Page): Promise<void> {
  await openAdmin(page)
  await openNav(page, "Settings")
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible()
}

function resourcePanel(page: Page) {
  return page.locator('section:has(> header > h2:text-is("Resource access"))')
}

function accessButton(page: Page) {
  return page.getByRole("button", { name: /^Access for / })
}

const USERS = [
  { id: 1, username: "kyros", role: "admin", display_name: "Kyros" },
  { id: 2, username: "alice", role: "user", display_name: "Alice" },
]

function sessionRow() {
  return resourceRow("session", 7, "F1 Weekend", 2)
}

function resourceRow(resourceType: string, id: number, label: string, viewerCount = 0, owner = "kyros") {
  return {
    resource_type: resourceType,
    id,
    label,
    owner,
    owner_missing: owner !== "" && !USERS.some((user) => user.username === owner),
    viewer_count: viewerCount,
    system: false,
  }
}

function recordingRow() {
  return {
    id: 3,
    user_friendly_name: "Speedcubing finals",
    snake_case_name: "speedcubing_finals",
    content_url: "https://example.test/content/speedcubing_3/recording.mp4",
    profile_name: "speedcubing",
    engine_name: "yt_dlp_piped",
    resolver_name: "daddylive",
    started_at: "2026-10-09 17:00:00",
    ended_at: "2026-10-09 18:00:00",
    duration_seconds: 3600,
    size_bytes: 123456789,
    created_at: "2026-10-09 18:00:00",
  }
}

test.describe("admin resource access", () => {
  test("lists resources and leaves system rows read-only", async ({ page, api }) => {
    api.data.users = USERS
    api.data.resources = [
      sessionRow(),
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
    await page.getByRole("button", { name: "Apply changes" }).click()
    await expect
      .poll(() => api.callsTo("/admin/resources/session/7/owner").some((call) => call.method === "PUT"))
      .toBe(true)

    await page.getByLabel("Add a viewer", { exact: true }).selectOption("alice")
    await page.getByRole("button", { name: "Add", exact: true }).click()
    await page.getByRole("button", { name: "Apply changes" }).click()
    await expect
      .poll(() => api.callsTo("/admin/resources/session/7/access").some((call) => call.method === "POST"))
      .toBe(true)

    await page.getByRole("button", { name: "Remove alice" }).click()
    await page.getByRole("button", { name: "Apply changes" }).click()
    await expect
      .poll(() => api.callsTo("/admin/resources/session/7/access/alice").some((call) => call.method === "DELETE"))
      .toBe(true)
  })

  test("puts the access button on every owner-bearing list", async ({ page, api }) => {
    api.data.users = USERS
    api.data.sessions = [session({ id: 7 })]
    api.data.autoruns = [autorun({ id: 5, user_friendly_name: "F1 Race" })]
    api.data.recordings = [recordingRow()]
    api.data.profiles = [profile()]
    api.data.sources = [source()]

    await openAdmin(page)
    await expect(accessButton(page).first()).toBeVisible()

    for (const label of ["Autoruns", "Recordings"]) {
      await openNav(page, label)
      await expect(accessButton(page).first()).toBeVisible()
    }

    // Presets paints both panels at once — profiles above, saved sources below.
    await openNav(page, "Presets")
    await expect(page.getByRole("button", { name: "Access for F1 Weekend" }).first()).toBeVisible()
    await expect(page.getByRole("button", { name: "Access for Sky Sports" }).first()).toBeVisible()
  })

  test("edits an item's access from its own button", async ({ page, api }) => {
    api.data.users = USERS
    api.data.autoruns = [autorun({ id: 5, user_friendly_name: "F1 Race" })]
    api.data.resources = [resourceRow("autorun", 5, "F1 Race")]

    await openAdmin(page)
    await openNav(page, "Autoruns")

    const button = page.getByRole("button", { name: "Access for F1 Race" })
    await button.hover()

    await expect(page.getByText("View access")).toBeVisible()
    await expect(page.getByText("Only the owner can see this item.")).toBeVisible()

    await page.getByLabel("Owner", { exact: true }).selectOption("alice")
    await page.getByRole("button", { name: "Apply changes" }).click()
    await expect
      .poll(() => api.callsTo("/admin/resources/autorun/5/owner").some((call) => call.method === "PUT"))
      .toBe(true)
  })

  test("bulk access warns before overriding an item's own access", async ({ page, api }) => {
    api.data.users = USERS
    api.data.autoruns = [
      autorun({ id: 5, user_friendly_name: "F1 Race" }),
      autorun({ id: 6, user_friendly_name: "F2 Sprint" }),
    ]
    api.data.resources = [resourceRow("autorun", 5, "F1 Race", 0, "ghost"), resourceRow("autorun", 6, "F2 Sprint")]

    await openAdmin(page)
    await openNav(page, "Autoruns")

    await page.getByRole("checkbox", { name: "Select F1 Race" }).check()
    await page.getByRole("checkbox", { name: "Select F2 Sprint" }).check()
    await page.getByRole("button", { name: "Access", exact: true }).click()

    await expect(page.getByText("Access on 2 item(s)")).toBeVisible()
    await expect(page.getByText("1 already overridden")).toBeVisible()
    await expect(page.getByText("Owner account missing")).toBeVisible()

    await page.getByRole("checkbox", { name: "Change owner" }).check()
    await page.getByLabel("New owner").selectOption("alice")
    await page.getByRole("button", { name: "Apply to 2" }).click()

    await expect(page.getByText("Override 1 item(s)?")).toBeVisible()
    await expect(page.getByRole("dialog").getByText("F1 Race")).toBeVisible()

    await page.getByRole("button", { name: "Override and apply" }).click()
    await expect
      .poll(() => api.callsTo("/admin/resources/autorun/5/owner").some((call) => call.method === "PUT"))
      .toBe(true)
    await expect
      .poll(() => api.callsTo("/admin/resources/autorun/6/owner").some((call) => call.method === "PUT"))
      .toBe(true)
  })
})
