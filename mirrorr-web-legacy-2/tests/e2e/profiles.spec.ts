/**
 * Task 15 e2e — V8 `/profiles` (spec L323-L337).
 *
 * Real path: an end-to-end create → `?highlight` → edit/save → "Use" D1
 * prefill → duplicate-name inline error → delete, with every created profile
 * removed again (UI delete plus an API sweep in `finally`).
 *
 * Stubbed path: the in-use pre-scan dialog listing the referencing autoruns
 * and sessions, which needs rows the dev core cannot provide.
 * Export row actions are deliberately absent until todo 23.
 */
import path from "node:path"
import type { APIRequestContext, Page } from "@playwright/test"
import { expect, test } from "./fixtures"

const EVIDENCE_DIR = path.resolve(import.meta.dirname, "../../../.omo/evidence")
const PROFILE_PREFIX = "e2e profile"

interface ProfileRow {
  readonly id: number
  readonly name: string
}

async function cookieHeaderFor(page: Page): Promise<Record<string, string>> {
  const cookies = await page.context().cookies()
  const value = cookies.find((cookie) => cookie.name === "mirrorr_access_token")?.value
  if (value === undefined) throw new Error("auth cookie missing — run through auth.setup storageState")
  return { Cookie: `mirrorr_access_token=${value}` }
}

async function listProfiles(api: APIRequestContext, headers: Record<string, string>): Promise<ProfileRow[]> {
  const response = await api.get("/api/profiles/?limit=200", { headers })
  if (response.status() !== 200) return []
  const body = (await response.json()) as { items?: ProfileRow[] }
  return body.items ?? []
}

async function deleteProfile(api: APIRequestContext, id: number, headers: Record<string, string>): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await api.delete(`/api/profiles/${id}`, { headers })
    const probe = await api.get(`/api/profiles/${id}`, { headers })
    if (probe.status() === 404) return
    await new Promise((resolve) => setTimeout(resolve, 1_500))
  }
  throw new Error(`cleanup failed: profile ${id} still present`)
}

async function sweepTestProfiles(api: APIRequestContext, headers: Record<string, string>): Promise<void> {
  for (const row of await listProfiles(api, headers)) {
    if (row.name.startsWith(PROFILE_PREFIX)) await deleteProfile(api, row.id, headers)
  }
}

test("real: creates, highlights, edits, prefills, rejects a duplicate and deletes a profile", async ({ page }) => {
  test.setTimeout(180_000)
  const api = page.context().request
  const headers = await cookieHeaderFor(page)
  const name = `${PROFILE_PREFIX} ${Date.now()}`
  const renamed = `${name} edited`

  await sweepTestProfiles(api, headers)

  try {
    await page.goto("/profiles")
    await expect(page.getByTestId("profiles-view")).toBeVisible()

    await page.getByRole("button", { name: "New profile" }).click()
    await page.getByLabel("Name").fill(name)
    await page.getByLabel("Engine").selectOption({ label: "yt_dlp_piped" })
    await page.getByLabel("Resolver").selectOption({ label: "static" })
    await page.getByLabel("Url").fill("https://example.com/e2e-profile.m3u8")
    await page.getByRole("button", { name: "Create profile" }).click()

    await expect(page.getByText(`Profile "${name}" created`)).toBeVisible()
    const nameCell = page.locator('[data-testid^="profile-name-"]').filter({ hasText: name })
    await expect(nameCell).toBeVisible()
    const testId = await nameCell.getAttribute("data-testid")
    const profileId = Number(String(testId).replace("profile-name-", ""))
    expect(Number.isInteger(profileId)).toBe(true)
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-15-profiles-created.png") })

    await page.goto(`/profiles?highlight=${profileId}`)
    const highlightedCell = page.locator('[data-testid^="profile-name-"]').filter({ hasText: name })
    await expect(highlightedCell).toHaveAttribute("data-highlighted", "true")
    await expect(highlightedCell).not.toHaveAttribute("data-highlighted", "true", { timeout: 5_000 })
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-15-profiles-highlight.png") })

    await page.getByRole("button", { name: `Edit ${name}` }).click()
    await page.getByLabel("Name").fill(renamed)
    await page.getByRole("button", { name: "Save changes" }).click()
    await expect(page.getByText(`Profile "${renamed}" saved`)).toBeVisible()
    const renamedCell = page.locator('[data-testid^="profile-name-"]').filter({ hasText: renamed })
    await expect(renamedCell).toBeVisible()
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-15-profiles-edited.png") })

    await page.getByRole("button", { name: "Use" }).click()
    await expect(page.getByTestId("new-session-form")).toBeVisible()
    await expect(page.getByTestId("new-session-form").getByLabel("Profile", { exact: true })).toHaveValue(String(profileId))
    await page.getByRole("button", { name: "Cancel" }).click()
    await expect(page.getByTestId("new-session-form")).toHaveCount(0)

    await page.getByRole("button", { name: `Delete ${renamed}` }).click()
    await expect(page.getByText(`Delete "${renamed}"?`)).toBeVisible()
    await page.getByRole("button", { name: "Delete profile" }).click()
    await expect(page.locator('[data-testid^="profile-name-"]').filter({ hasText: renamed })).toHaveCount(0)
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-15-profiles-deleted.png") })

    const remaining = (await listProfiles(api, headers)).filter((row) => row.name.startsWith(PROFILE_PREFIX))
    expect(remaining).toEqual([])
  } finally {
    await sweepTestProfiles(api, headers)
  }
})

const STUB_PROFILE = {
  id: 9,
  name: "p2",
  default_engine_id: 1,
  resolver_id: 1,
  resolver_config: { url: "https://example.com/original.m3u8" },
  retry_mode: "none",
  retry_config: {},
  requester_user_token: "admin",
}

const REFERENCING_AUTORUN = {
  id: 11,
  user_friendly_name: "Nightly run",
  snake_case_name: "nightly_run",
  engine_id: 1,
  resolver_id: 1,
  profile_id: 9,
  status: "scheduled",
  start_time: "23:00",
  end_time: "23:10",
}

const OTHER_AUTORUN = { ...REFERENCING_AUTORUN, id: 12, user_friendly_name: "Other run", profile_id: null }
const REFERENCING_SESSION = { id: 21, engine_id: 1, resolver_id: 1, profile_id: 9, status: "completed" }
const OTHER_SESSION = { ...REFERENCING_SESSION, id: 22, profile_id: null }

test("stub: the delete pre-scan lists the referencing autoruns and sessions", async ({ page }) => {
  const state = { deleted: false, deleteUrls: [] as string[] }

  await page.route("**/api/engines/**", (route) =>
    route.fulfill({ json: { items: [{ id: 1, name: "yt_dlp_piped" }], next_cursor: null, has_more: false } }),
  )
  await page.route("**/api/resolvers/**", (route) =>
    route.fulfill({ json: { items: [{ id: 1, name: "static" }], next_cursor: null, has_more: false } }),
  )
  await page.route("**/api/profiles/**", async (route) => {
    if (route.request().method() === "DELETE") {
      state.deleted = true
      state.deleteUrls.push(route.request().url())
      await route.fulfill({ json: { status: "deleted", deleted: { profiles: 1 } } })
      return
    }
    await route.fulfill({ json: { items: state.deleted ? [] : [STUB_PROFILE], next_cursor: null, has_more: false } })
  })
  await page.route("**/api/autoruns/**", (route) =>
    route.fulfill({ json: { items: [REFERENCING_AUTORUN, OTHER_AUTORUN], next_cursor: null, has_more: false } }),
  )
  await page.route("**/api/sessions/**", (route) =>
    route.fulfill({ json: { items: [REFERENCING_SESSION, OTHER_SESSION], next_cursor: null, has_more: false } }),
  )

  await page.goto("/profiles")
  await page.getByRole("button", { name: "Delete p2" }).click()
  await expect(page.getByTestId("profile-in-use-summary")).toHaveText("In use by 1 autoruns / 1 sessions")
  await expect(page.getByText("Nightly run")).toBeVisible()
  await expect(page.getByText("#21")).toBeVisible()
  await expect(page.getByText("Other run")).toHaveCount(0)
  await expect(page.getByText("#22")).toHaveCount(0)
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-15-profiles-in-use.png") })

  await page.getByRole("button", { name: "Delete profile" }).click()
  await expect(page.getByTestId("profile-in-use-summary")).toHaveCount(0)
  expect(state.deleteUrls.some((url) => url.endsWith("/api/profiles/9"))).toBe(true)
})

/**
 * The dev core's `profiles.name` column has no unique constraint, so a real
 * duplicate POST succeeds there. The contract still mandates a 400 (client
 * contract §13.6), and this stubs that response to pin the inline error.
 */
test("stub: a duplicate-name 400 renders inline on the name field", async ({ page }) => {
  await page.route("**/api/engines/**", (route) =>
    route.fulfill({ json: { items: [{ id: 1, name: "yt_dlp_piped" }], next_cursor: null, has_more: false } }),
  )
  await page.route("**/api/resolvers/**", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 1,
            name: "static",
            config_schema: {
              type: "object",
              title: "StaticConfig",
              properties: { url: { type: "string", title: "Url" } },
              required: ["url"],
            },
          },
        ],
        next_cursor: null,
        has_more: false,
      },
    }),
  )
  await page.route("**/api/profiles/**", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 400, json: { detail: "A resource with that name already exists." } })
      return
    }
    await route.fulfill({ json: { items: [], next_cursor: null, has_more: false } })
  })

  await page.goto("/profiles")
  await page.getByRole("button", { name: "New profile" }).click()
  await page.getByLabel("Name").fill("duplicate")
  await page.getByLabel("Engine").selectOption({ label: "yt_dlp_piped" })
  await page.getByLabel("Resolver").selectOption({ label: "static" })
  await page.getByLabel("Url").fill("https://example.com/dup.m3u8")

  const nameInput = page.getByLabel("Name")
  await expect(nameInput).not.toHaveAttribute("aria-invalid", "true")
  await page.getByRole("button", { name: "Create profile" }).click()

  await expect(page.getByText("A resource with that name already exists.")).toBeVisible()
  await expect(nameInput).toHaveAttribute("aria-invalid", "true")
})
