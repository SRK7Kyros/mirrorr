/**
 * Task 22 e2e — V10 `/import-export` (web-frontend-spec L347-L362,
 * general-client-specification §9/§13.5).
 *
 * Real path: a fixture bundle is imported through the live four-step wizard
 * (choose → review → resolve → apply) against the dev core, asserting the
 * badge derivation, the `name_2` rename preview, the apply summary and the
 * created resources; every created profile/autorun is deleted again (UI file
 * then API sweep in `finally`).
 *
 * Client-only paths: the `version === 1` and >500-item guards must block
 * before any validate request; a stubbed apply 400 must render the error panel
 * on step 3 while the bundle stays editable.
 */
import { appendFile, mkdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { APIRequestContext, Page } from "@playwright/test"
import { expect, test } from "./fixtures"

const EVIDENCE_DIR = path.resolve(import.meta.dirname, "../../../.omo/evidence")
const IMPORT_PREFIX = "e2e import"
const EXCEEDED_ITEMS = 501

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

interface DeletionReceipt {
  readonly kind: "profile" | "autorun"
  readonly id: number
  readonly name: string
  readonly statuses: number[]
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

/** Deletes every autorun before every profile under the test prefix (FK order); returns the receipt. */
async function sweepImportData(api: APIRequestContext, headers: Record<string, string>): Promise<DeletionReceipt[]> {
  const receipts: DeletionReceipt[] = []
  for (const autorun of await listAutoruns(api, headers)) {
    if (autorun.user_friendly_name.startsWith(IMPORT_PREFIX)) {
      const statuses = await deleteAutorun(api, autorun.id, headers)
      receipts.push({ kind: "autorun", id: autorun.id, name: autorun.user_friendly_name, statuses })
    }
  }
  for (const profile of await listProfiles(api, headers)) {
    if (profile.name.startsWith(IMPORT_PREFIX)) {
      const statuses = await deleteProfile(api, profile.id, headers)
      receipts.push({ kind: "profile", id: profile.id, name: profile.name, statuses })
    }
  }
  return receipts
}

/** Appends the cleanup receipt to a temp file the task-22 evidence cites. */
async function writeCleanupReceipt(lines: readonly string[]): Promise<void> {
  const dir = path.join(os.tmpdir(), "opencode-task22")
  await mkdir(dir, { recursive: true })
  await appendFile(path.join(dir, "task-22-cleanup.txt"), `${lines.join("\n")}\n`)
}

async function firstPlugin(api: APIRequestContext, headers: Record<string, string>, collection: string): Promise<PluginRow> {
  const response = await api.get(`/api/${collection}/?limit=200`, { headers })
  expect(response.status(), `GET /api/${collection}/ must answer 200`).toBe(200)
  const body = (await response.json()) as { items?: PluginRow[] }
  const plugin = (body.items ?? []).find((item) => typeof item.origin_hash === "string" && item.origin_hash.length > 0)
  if (plugin === undefined) throw new Error(`dev core must seed at least one ${collection} with an origin_hash`)
  return plugin
}

test("real: imports a fixture bundle through choose → review → resolve → apply, then cleans up", async ({ page }) => {
  test.setTimeout(180_000)
  const api = page.context().request
  const headers = await cookieHeaderFor(page)
  const loginPosts = trackLoginPosts(page)
  const stamp = Date.now()
  const conflictName = `${IMPORT_PREFIX} ${stamp}`
  const mappedName = `${conflictName} mapped`
  const autorunName = `${conflictName} auto`

  await sweepImportData(api, headers)

  const engine = await firstPlugin(api, headers, "engines")
  const resolver = await firstPlugin(api, headers, "resolvers")

  const seededResponse = await api.post("/api/profiles/", {
    headers: { ...headers, "Content-Type": "application/json" },
    data: {
      name: conflictName,
      default_engine_id: engine.id,
      resolver_id: resolver.id,
      resolver_config: { url: "https://example.com/task-22-original.m3u8" },
      retry_mode: "none",
      retry_config: {},
    },
  })
  expect(seededResponse.ok(), "seeding the conflicting profile must succeed").toBe(true)
  const seeded = (await seededResponse.json()) as { id: number }

  const conflictProfile = {
    name: conflictName,
    default_engine: { name: engine.name, origin_hash: engine.origin_hash },
    resolver: { name: resolver.name, origin_hash: resolver.origin_hash },
    resolver_config: { url: "https://example.com/task-22-imported.m3u8" },
    retry_mode: "none",
    retry_config: {},
    content_hash: "fixture",
  }
  const mappedProfile = {
    name: mappedName,
    default_engine: { name: "ghost_engine", origin_hash: "cafe0123cafe0123cafe0123cafe0123cafe0123cafe0123cafe0123cafe0123" },
    resolver: { name: resolver.name, origin_hash: resolver.origin_hash },
    resolver_config: { url: "https://example.com/task-22-mapped.m3u8" },
    retry_mode: "none",
    retry_config: {},
    content_hash: "fixture",
  }
  const bundle = {
    version: 1,
    exported_at: "2050-01-01T00:00:00",
    profiles: [conflictProfile, mappedProfile],
    autoruns: [
      {
        user_friendly_name: autorunName,
        profile_name: conflictName,
        profile: conflictProfile,
        start_time: "2050-07-15T10:00:00",
        end_time: "2050-07-15T11:00:00",
        recording: false,
        content_hash: "fixture",
      },
    ],
  }

  try {
    await page.goto("/import-export")
    await expect(page.getByTestId("import-export-view")).toBeVisible()
    await expect(page.getByTestId("export-explainer")).toContainText("per-row")

    await page.getByLabel("Bundle file").setInputFiles({
      name: "task-22-bundle.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(bundle)),
    })
    await expect(page.getByTestId("picked-file")).toContainText("task-22-bundle.json")
    await expect(page.getByTestId("picked-file")).toContainText("2 profiles")
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-22-choose.png") })

    await page.getByRole("button", { name: "Validate" }).click()
    await expect(page.getByTestId("wizard-review")).toBeVisible()
    await expect(page.getByTestId(`badge-profile-${conflictName}`)).toHaveText("Conflict")
    await expect(page.getByTestId(`badge-profile-${mappedName}`)).toHaveText("Needs mapping")
    await expect(page.getByRole("button", { name: "Back" })).toBeEnabled()
    await expect(page.getByText(`Will be imported as ${conflictName}_2`)).toBeVisible()
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-22-review.png") })

    await page.getByRole("button", { name: "Next" }).click()
    await expect(page.getByTestId("wizard-resolve")).toBeVisible()
    await page.getByLabel(`Engine for ghost_engine (${mappedName})`).selectOption(String(engine.id))
    await expect(page.getByTestId("unresolved-hint")).toHaveCount(0)
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-22-resolve.png") })

    await page.getByRole("button", { name: "Apply" }).click()
    await expect(page.getByTestId("apply-summary")).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId("apply-summary")).toContainText("2 profiles created")
    await expect(page.getByTestId("apply-summary")).toContainText("0 profiles skipped (already imported)")
    await expect(page.getByTestId("apply-summary")).toContainText("1 autorun created")
    await expect(page.getByTestId("apply-summary").getByRole("link", { name: "View profiles" })).toBeVisible()
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-22-applied.png") })

    const profileNames = (await listProfiles(api, headers)).map((row) => row.name)
    expect(profileNames).toContain(`${conflictName}_2`)
    expect(profileNames).toContain(mappedName)
    const autorunNames = (await listAutoruns(api, headers)).map((row) => row.user_friendly_name)
    expect(autorunNames).toContain(autorunName)
  } finally {
    const before = {
      profiles: (await listProfiles(api, headers)).filter((row) => row.name.startsWith(IMPORT_PREFIX)),
      autoruns: (await listAutoruns(api, headers)).filter((row) => row.user_friendly_name.startsWith(IMPORT_PREFIX)),
    }
    const receipts = await sweepImportData(api, headers)
    const leftovers = {
      profiles: (await listProfiles(api, headers)).filter((row) => row.name.startsWith(IMPORT_PREFIX)),
      autoruns: (await listAutoruns(api, headers)).filter((row) => row.user_friendly_name.startsWith(IMPORT_PREFIX)),
    }
    await writeCleanupReceipt([
      `seeded: profile ${conflictName} id=${seeded.id}`,
      `present before cleanup: profiles=[${before.profiles.map((row) => `${row.name}#${row.id}`).join(", ")}] autoruns=[${before.autoruns.map((row) => `${row.user_friendly_name}#${row.id}`).join(", ")}]`,
      ...receipts.map((receipt) => `deleted ${receipt.kind} ${receipt.id} "${receipt.name}" DELETE statuses=[${receipt.statuses.join(",")}]`),
      `post-sweep leftovers: profiles=[${leftovers.profiles.map((row) => row.name).join(", ")}] autoruns=[${leftovers.autoruns.map((row) => row.user_friendly_name).join(", ")}]`,
    ])
    expect(leftovers.profiles).toEqual([])
    expect(leftovers.autoruns).toEqual([])
  }

  expect(loginPosts(), "the session must not re-authenticate").toBe(0)
})

test("client guards: version ≠ 1 and >500 items are blocked before any validate call", async ({ page }) => {
  const loginPosts = trackLoginPosts(page)
  const validatePaths: string[] = []
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/import-export/validate") {
      validatePaths.push(request.url())
    }
  })

  await page.goto("/import-export")
  await expect(page.getByTestId("import-wizard")).toBeVisible()

  await page.getByLabel("Bundle file").setInputFiles({
    name: "version-2.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ version: 2, profiles: [], autoruns: [] })),
  })
  await expect(page.getByTestId("guard-error")).toHaveText("Unsupported bundle version")
  await expect(page.getByRole("button", { name: "Validate" })).toBeDisabled()

  const oversized = { version: 1, profiles: Array.from({ length: EXCEEDED_ITEMS }, (_, index) => ({ name: `p${index}` })) }
  await page.getByLabel("Bundle file").setInputFiles({
    name: "too-large.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(oversized)),
  })
  await expect(page.getByTestId("guard-error")).toHaveText("Bundle exceeds 500 items")
  await expect(page.getByRole("button", { name: "Validate" })).toBeDisabled()

  expect(validatePaths, "guards must never reach the validate endpoint").toEqual([])
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-22-guards.png") })
  expect(loginPosts(), "the session must not re-authenticate").toBe(0)
})

test("apply failure: a stubbed 400 renders the error panel and stays on step 3", async ({ page }) => {
  const loginPosts = trackLoginPosts(page)
  const api = page.context().request
  const headers = await cookieHeaderFor(page)
  const engine = await firstPlugin(api, headers, "engines")
  const applyBodies: unknown[] = []

  await page.route("**/api/import-export/validate", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        valid: false,
        profiles: [
          {
            name: "stub-profile",
            content_hash: "deadbeefcafe",
            valid: false,
            issues: [
              {
                problem: "not_installed",
                field: "engine",
                bundled: { name: "ghost_engine", origin_hash: "cafe" },
                alternatives: [{ id: engine.id, name: engine.name, origin_hash: engine.origin_hash }],
              },
            ],
          },
        ],
        autoruns: [],
      }),
    })
  })
  await page.route("**/api/import-export/apply", async (route) => {
    applyBodies.push(route.request().postDataJSON())
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Cannot resolve engine for profile 'stub-profile'" }),
    })
  })

  await page.goto("/import-export")
  await page.getByLabel("Bundle file").setInputFiles({
    name: "stub.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ version: 1, profiles: [{ name: "stub-profile" }], autoruns: [] })),
  })
  await page.getByRole("button", { name: "Validate" }).click()
  await expect(page.getByText("Needs mapping")).toBeVisible()
  await page.getByRole("button", { name: "Next" }).click()
  await page.getByLabel("Engine for ghost_engine (stub-profile)").selectOption(String(engine.id))
  await page.getByRole("button", { name: "Apply" }).click()

  const panel = page.getByRole("alert").filter({ hasText: "Import failed" })
  await expect(panel).toBeVisible()
  await expect(panel).toContainText("Cannot resolve engine for profile 'stub-profile'")
  await expect(page.getByTestId("wizard-step")).toContainText("Step 3 of 4")
  await expect(page.getByRole("button", { name: "Apply" })).toBeEnabled()

  const body = applyBodies[0] as { plugin_map?: Record<string, { type: string; id: number }> } | undefined
  expect(body?.plugin_map?.cafe).toEqual({ type: "engine", id: engine.id })

  await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-22-apply-error.png") })
  expect(loginPosts(), "the session must not re-authenticate").toBe(0)
})
