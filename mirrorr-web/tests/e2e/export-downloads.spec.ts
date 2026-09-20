/**
 * Task 23 e2e — per-row export downloads (`docs/web-frontend-spec.md` L295,
 * L331, L546, L614; `docs/general-client-specification.md` §9/§13.5).
 *
 * Happy: a real profile row and a real autorun row each produce a download
 * whose bytes parse against `bundleSchema` with `version === 1`; auth rides the
 * cookie (no token in the URL).
 *
 * Failure: the export request is intercepted (`page.route`) and the
 * browser-level object-URL download is disabled (the WebView case), so the
 * "Export ready — copy the JSON" dialog must keep the payload and the Copy
 * action must put it on the clipboard.
 *
 * Read-only: exports create nothing. The seeded fixtures are deleted in
 * `finally` (autorun before profile — FK order) and a leftover probe confirms
 * the prefix is gone.
 */
import { appendFile, mkdir, readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { APIRequestContext, Page } from "@playwright/test"
import { bundleSchema } from "../../src/lib/schemas/import-export"
import { expect, test } from "./fixtures"

const EVIDENCE_DIR = path.resolve(import.meta.dirname, "../../../.omo/evidence")
const EXPORT_PREFIX = "e2e export"
const E2E_ORIGIN = "http://127.0.0.1:5175"
const FALLBACK_TITLE = "Export ready — copy the JSON"

// The three tests share the live dev core and one prefix-scoped sweep; running
// them in parallel lets one test's sweep delete a sibling's just-seeded row.
test.describe.configure({ mode: "serial" })

interface ProfileRow {
  readonly id: number
  readonly name: string
}

interface AutorunRow {
  readonly id: number
  readonly user_friendly_name: string
}

interface PluginRow {
  readonly id: number
  readonly name: string
  readonly origin_hash?: string | null
}

function trackLoginPosts(page: Page): () => number {
  let loginPosts = 0
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/auth/login") {
      loginPosts += 1
    }
  })
  return () => loginPosts
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

async function listAutoruns(api: APIRequestContext, headers: Record<string, string>): Promise<AutorunRow[]> {
  const response = await api.get("/api/autoruns/?limit=200", { headers })
  if (response.status() !== 200) return []
  const body = (await response.json()) as { items?: AutorunRow[] }
  return body.items ?? []
}

async function deleteProfile(api: APIRequestContext, id: number, headers: Record<string, string>): Promise<number[]> {
  const statuses: number[] = []
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await api.delete(`/api/profiles/${id}`, { headers })
    statuses.push(response.status())
    const probe = await api.get(`/api/profiles/${id}`, { headers })
    if (probe.status() === 404) return statuses
    await new Promise((resolve) => setTimeout(resolve, 1_500))
  }
  throw new Error(`cleanup failed: profile ${id} still present`)
}

async function deleteAutorun(api: APIRequestContext, id: number, headers: Record<string, string>): Promise<number[]> {
  const statuses: number[] = []
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await api.delete(`/api/autoruns/${id}`, { headers })
    statuses.push(response.status())
    const probe = await api.get(`/api/autoruns/${id}`, { headers })
    if (probe.status() === 404) return statuses
    await new Promise((resolve) => setTimeout(resolve, 1_500))
  }
  throw new Error(`cleanup failed: autorun ${id} still present`)
}

/** Deletes every autorun before every profile under the export prefix (FK order). */
async function sweepExportData(api: APIRequestContext, headers: Record<string, string>): Promise<string[]> {
  const receipt: string[] = []
  for (const autorun of await listAutoruns(api, headers)) {
    if (autorun.user_friendly_name.startsWith(EXPORT_PREFIX)) {
      receipt.push(`autorun ${autorun.id} DELETE ${(await deleteAutorun(api, autorun.id, headers)).join(",")}`)
    }
  }
  for (const profile of await listProfiles(api, headers)) {
    if (profile.name.startsWith(EXPORT_PREFIX)) {
      receipt.push(`profile ${profile.id} DELETE ${(await deleteProfile(api, profile.id, headers)).join(",")}`)
    }
  }
  return receipt
}

async function firstPlugin(
  api: APIRequestContext,
  headers: Record<string, string>,
  collection: string,
): Promise<PluginRow> {
  const response = await api.get(`/api/${collection}/?limit=200`, { headers })
  expect(response.status(), `GET /api/${collection}/ must answer 200`).toBe(200)
  const body = (await response.json()) as { items?: PluginRow[] }
  const plugin = (body.items ?? []).find((item) => typeof item.origin_hash === "string" && item.origin_hash.length > 0)
  if (plugin === undefined) throw new Error(`dev core must seed at least one ${collection} with an origin_hash`)
  return plugin
}

async function seedProfile(
  api: APIRequestContext,
  headers: Record<string, string>,
  name: string,
): Promise<{ id: number; engineId: number; resolverId: number }> {
  const engine = await firstPlugin(api, headers, "engines")
  const resolver = await firstPlugin(api, headers, "resolvers")
  const response = await api.post("/api/profiles/", {
    headers: { ...headers, "Content-Type": "application/json" },
    data: {
      name,
      default_engine_id: engine.id,
      resolver_id: resolver.id,
      resolver_config: { url: "https://example.com/task-23-export.m3u8" },
      retry_mode: "none",
      retry_config: {},
    },
  })
  expect(response.ok(), `seeding profile "${name}" must succeed`).toBe(true)
  const body = (await response.json()) as { id: number }
  return { id: body.id, engineId: engine.id, resolverId: resolver.id }
}

async function writeCleanupReceipt(lines: readonly string[]): Promise<void> {
  const dir = path.join(os.tmpdir(), "mirrorr-task23")
  await mkdir(dir, { recursive: true })
  await appendFile(path.join(dir, "task-23-cleanup.txt"), `${lines.join("\n")}\n`)
}

async function assertNoLeftovers(api: APIRequestContext, headers: Record<string, string>): Promise<void> {
  const profiles = (await listProfiles(api, headers)).filter((row) => row.name.startsWith(EXPORT_PREFIX))
  const autoruns = (await listAutoruns(api, headers)).filter((row) =>
    row.user_friendly_name.startsWith(EXPORT_PREFIX),
  )
  expect(profiles, "no export fixtures may remain").toEqual([])
  expect(autoruns, "no export fixtures may remain").toEqual([])
}

test("real: a profile row export downloads a v1 bundle", async ({ page }) => {
  test.setTimeout(120_000)
  const api = page.context().request
  const headers = await cookieHeaderFor(page)
  const loginPosts = trackLoginPosts(page)
  const name = `${EXPORT_PREFIX} profile ${Date.now()}`
  const receipt = await sweepExportData(api, headers)
  const profile = await seedProfile(api, headers, name)

  try {
    await page.goto("/profiles")
    await expect(page.getByTestId("profiles-view")).toBeVisible()
    const row = page.getByRole("row").filter({ hasText: name })
    await expect(row).toBeVisible()

    const downloadPromise = page.waitForEvent("download")
    await row.getByRole("button", { name: `Export ${name}` }).click()
    const download = await downloadPromise

    expect(download.suggestedFilename()).toBe(`profile-${profile.id}.json`)
    const downloadPath = await download.path()
    if (downloadPath === null) throw new Error("the profile export produced no download file")
    const text = await readFile(downloadPath, "utf8")
    const bundle = bundleSchema.parse(JSON.parse(text))
    expect(bundle.version).toBe(1)
    expect(bundle.profiles.map((entry) => entry.name)).toEqual([name])
    expect(bundle.autoruns).toEqual([])
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-23-profile-download.png") })

    expect(loginPosts(), "the session must not re-authenticate").toBe(0)
    await writeCleanupReceipt([`profile-export ${profile.id} downloaded ${download.suggestedFilename()}`])
  } finally {
    receipt.push(`profile ${profile.id} DELETE ${(await deleteProfile(api, profile.id, headers)).join(",")}`)
    await assertNoLeftovers(api, headers)
    await writeCleanupReceipt(receipt)
  }
})

test("real: an autorun row export downloads a v1 bundle with its embedded profile", async ({ page }) => {
  test.setTimeout(120_000)
  const api = page.context().request
  const headers = await cookieHeaderFor(page)
  const loginPosts = trackLoginPosts(page)
  const stamp = Date.now()
  const profileName = `${EXPORT_PREFIX} autorun profile ${stamp}`
  const autorunName = `${EXPORT_PREFIX} autorun ${stamp}`
  const receipt = await sweepExportData(api, headers)
  const profile = await seedProfile(api, headers, profileName)
  const seeded = await api.post("/api/autoruns/", {
    headers: { ...headers, "Content-Type": "application/json" },
    data: {
      user_friendly_name: autorunName,
      snake_case_name: "task_23_export",
      profile_id: profile.id,
      engine_id: profile.engineId,
      resolver_id: profile.resolverId,
      resolver_config: { url: "https://example.com/task-23-export.m3u8" },
      retry_mode: "none",
      retry_config: {},
      start_time: "2050-07-15T10:00:00",
      end_time: "2050-07-15T11:00:00",
      recording: false,
    },
  })
  expect(seeded.ok(), "seeding the autorun must succeed").toBe(true)
  const autorun = (await seeded.json()) as { id: number }

  try {
    await page.goto("/autoruns")
    await expect(page.getByTestId("autoruns-view")).toBeVisible()
    const row = page.getByRole("row").filter({ hasText: autorunName })
    await expect(row).toBeVisible()

    const downloadPromise = page.waitForEvent("download")
    await row.getByTestId(`autorun-${autorun.id}-export`).click()
    const download = await downloadPromise

    expect(download.suggestedFilename()).toBe(`autorun-${autorun.id}.json`)
    const downloadPath = await download.path()
    if (downloadPath === null) throw new Error("the autorun export produced no download file")
    const bundle = bundleSchema.parse(JSON.parse(await readFile(downloadPath, "utf8")))
    expect(bundle.version).toBe(1)
    expect(bundle.autoruns.map((entry) => entry.user_friendly_name)).toEqual([autorunName])
    expect(bundle.autoruns[0]?.profile_name).toBe(profileName)
    expect(bundle.profiles.map((entry) => entry.name)).toEqual([profileName])
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-23-autorun-download.png") })

    expect(loginPosts(), "the session must not re-authenticate").toBe(0)
  } finally {
    receipt.push(`autorun ${autorun.id} DELETE ${(await deleteAutorun(api, autorun.id, headers)).join(",")}`)
    receipt.push(`profile ${profile.id} DELETE ${(await deleteProfile(api, profile.id, headers)).join(",")}`)
    await assertNoLeftovers(api, headers)
    await writeCleanupReceipt(receipt)
  }
})

test("fallback: an intercepted download keeps the JSON copyable", async ({ page, context }) => {
  test.setTimeout(120_000)
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: E2E_ORIGIN })
  const api = page.context().request
  const headers = await cookieHeaderFor(page)
  const loginPosts = trackLoginPosts(page)
  const name = `${EXPORT_PREFIX} fallback ${Date.now()}`
  const receipt = await sweepExportData(api, headers)
  const profile = await seedProfile(api, headers, name)
  const intercepted = {
    version: 1,
    exported_at: "2050-01-01T00:00:00",
    profiles: [{ name, resolver_config: { url: "https://example.com/task-23-fallback.m3u8" } }],
    autoruns: [],
  }
  const interceptedText = JSON.stringify(intercepted)

  await page.route("**/api/import-export/profiles/*/export", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: interceptedText })
  })
  // The WebView case: the browser cannot start an object-URL download.
  await page.addInitScript(() => {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: undefined })
  })

  try {
    await page.goto("/profiles")
    await expect(page.getByTestId("profiles-view")).toBeVisible()
    const row = page.getByRole("row").filter({ hasText: name })
    await expect(row).toBeVisible()

    await row.getByRole("button", { name: `Export ${name}` }).click()
    await expect(page.getByRole("dialog", { name: FALLBACK_TITLE })).toBeVisible()
    const json = page.getByLabel("Exported bundle JSON")
    await expect(json).toHaveValue(interceptedText)
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-23-fallback-copy.png") })

    await page.getByRole("button", { name: "Copy JSON" }).click()
    await expect(page.getByTestId("toast").filter({ hasText: "JSON copied" })).toBeVisible()
    const clipboard = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboard).toBe(interceptedText)

    expect(loginPosts(), "the session must not re-authenticate").toBe(0)
  } finally {
    receipt.push(`profile ${profile.id} DELETE ${(await deleteProfile(api, profile.id, headers)).join(",")}`)
    await assertNoLeftovers(api, headers)
    await writeCleanupReceipt(receipt)
  }
})
