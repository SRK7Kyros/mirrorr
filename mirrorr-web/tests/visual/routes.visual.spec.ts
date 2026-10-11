import type { Page } from "@playwright/test"
import { expect, test, type ApiData, type ApiStub } from "../e2e/fixtures"
import { autorun, engine, profile, resolver, session } from "../e2e/fixtures"

/**
 * One screenshot per (route x state), rendered against the route-mocked API in
 * `tests/e2e/fixtures.ts`. States are chosen to exercise the surfaces where
 * fidelity lives: populated cards/tables, the empty state, an authenticated
 * detail view, and the anonymous auth screens.
 */

/** Frozen wall clock so relative-time text is stable run to run. */
const FIXED_NOW = new Date("2026-10-12T09:30:00Z")

function recording(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 301,
    user_friendly_name: "F1 Race",
    snake_case_name: "f1-race",
    content_url: "/content/f1-race/player.html",
    profile_name: "F1 Weekend",
    engine_name: "Streamlink",
    resolver_name: "Wide IPTV",
    started_at: "2026-10-11 18:00:00",
    ended_at: "2026-10-11 20:30:00",
    duration_seconds: 9000,
    size_bytes: 2_147_483_648,
    created_at: "2026-10-11 20:31:00",
    session_id: 103,
    media_served: true,
    ...overrides,
  }
}

// Statuses come from `src/api/status.ts` STATUS_MAP - the single source of
// truth. Chosen to exercise each tone/dot/icon branch: recording (danger+pulse),
// active (success), scheduled (primary), completed (success+check).
const SESSIONS = [
  session({
    id: 101,
    status: "recording",
    recording: true,
    profile_name: "F1 Weekend",
    started_at: "2026-10-12 08:12:00",
  }),
  session({ id: 102, status: "active", engine_name: "FFmpeg", resolver_name: "News Feed" }),
  session({ id: 103, status: "scheduled", resolver_name: "Wide IPTV" }),
  session({
    id: 104,
    status: "completed",
    started_at: "2026-10-11 18:00:00",
    ended_at: "2026-10-11 20:30:00",
  }),
]

const AUTORUNS = [autorun({ id: 201, status: "scheduled" }), autorun({ id: 202, status: "active" })]

const RECORDINGS = [
  recording(),
  recording({ id: 302, user_friendly_name: "Morning News", snake_case_name: "morning-news" }),
]

const PROFILES = [
  profile({ id: 401, name: "F1 Weekend" }),
  profile({ id: 402, name: "Morning News", engine_name: "FFmpeg", resolver_name: "News Feed" }),
]

const ENGINES = [engine({ id: 1, name: "Streamlink" }), engine({ id: 2, name: "FFmpeg", origin: "user" })]
const RESOLVERS = [
  resolver({ id: 1, name: "Wide IPTV" }),
  resolver({ id: 2, name: "News Feed", origin: "builtin" }),
]

interface Scenario {
  /** Snapshot basename, e.g. "sessions-list" -> `sessions-list.png`. */
  readonly name: string
  readonly path: string
  /** Rows to seed; omitted leaves every list empty. */
  readonly data?: Partial<ApiData>
  readonly anonymous?: boolean
}

const SCENARIOS: readonly Scenario[] = [
  { name: "login", path: "/login", anonymous: true },
  { name: "register", path: "/register", anonymous: true },
  { name: "sessions-list", path: "/sessions", data: { sessions: SESSIONS } },
  { name: "sessions-empty", path: "/sessions", data: { sessions: [] } },
  { name: "session-detail", path: "/sessions/101", data: { sessions: SESSIONS } },
  { name: "autoruns-list", path: "/autoruns", data: { autoruns: AUTORUNS } },
  { name: "autorun-detail", path: "/autoruns/201", data: { autoruns: AUTORUNS } },
  { name: "recordings-list", path: "/recordings", data: { recordings: RECORDINGS } },
  {
    name: "profiles-list",
    path: "/profiles",
    data: { profiles: PROFILES, engines: ENGINES, resolvers: RESOLVERS },
  },
  { name: "plugins", path: "/plugins", data: { engines: ENGINES, resolvers: RESOLVERS, profiles: PROFILES } },
  { name: "import-export", path: "/import-export" },
  { name: "settings", path: "/settings" },
  { name: "not-found", path: "/definitely-not-a-route" },
]

function seed(api: ApiStub, data: Partial<ApiData>): void {
  Object.assign(api.data, data)
}

/** Navigate, pin the clock, and wait for fonts + entrance animations. */
async function open(page: Page, path: string): Promise<void> {
  await page.clock.install()
  await page.clock.setFixedTime(FIXED_NOW)
  await page.goto(path)
  await page.waitForLoadState("load")
  // String form on purpose: this file is compiled by tsconfig.node (lib ES2023,
  // no DOM), so an arrow-function body referencing `document` fails typecheck.
  await page.evaluate("document.fonts.ready")
  await page.waitForTimeout(600)
}

for (const scenario of SCENARIOS) {
  test(`visual: ${scenario.name}`, async ({ page, api }) => {
    if (scenario.anonymous) api.data.authenticated = false
    if (scenario.data) seed(api, scenario.data)
    await open(page, scenario.path)
    await expect(page).toHaveScreenshot(`${scenario.name}.png`, { fullPage: true })
  })
}
