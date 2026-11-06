import type { Page } from "@playwright/test"
import type { ApiData } from "../e2e/fixtures"
import { autorun, engine, profile, resolver, session, source } from "../e2e/fixtures"

/**
 * The one list of screens the evidence harness knows about.
 *
 * Two consumers, so they can never disagree about what "the app" is:
 *   - `gallery.spec.ts` writes them to `docs/ux-audit/screens/` (the human
 *     before/after record, committed);
 *   - `routes.visual.spec.ts` asserts them against pixel baselines;
 *   - `a11y.spec.ts` runs axe and the target-size sweep over the same entries.
 *
 * A scenario is a *state*, not a route: the same path appears several times with
 * empty data, a forced failure, a held-open request or a dialog already open.
 */

/** Frozen wall clock so relative-time text is stable run to run. */
export const FIXED_NOW = new Date("2026-10-12T09:30:00Z")

export const VIEWPORTS = [
  { name: "375", width: 375, height: 812 },
  { name: "768", width: 768, height: 1024 },
  { name: "1280", width: 1280, height: 800 },
  { name: "1440", width: 1440, height: 900 },
] as const

export interface Scenario {
  /** Snapshot basename, e.g. "sessions-list" -> `sessions-list.png`. */
  readonly name: string
  readonly path: string
  /** Rows to seed; omitted leaves every list empty. */
  readonly data?: Partial<ApiData>
  readonly anonymous?: boolean
  /**
   * Enter through `admin.html` (the second build) and walk to `path`. The admin
   * entry is a real file on the dev server; its build is what a screenshot of
   * the administration section has to show.
   */
  readonly admin?: boolean
  /** Reach the state under test before the shot — a menu, a dialog, a filter. */
  readonly prepare?: (page: Page) => Promise<void>
  /**
   * `immediate` shoots before the stubbed request answers, which is the only way
   * a loading state can be photographed; the default settles fonts and motion.
   */
  readonly settle?: "idle" | "immediate"
  /** Restrict to a subset of `VIEWPORTS` names. */
  readonly viewports?: readonly string[]
  /** Dialogs and menus are not meaningful as a full-page accessibility claim. */
  readonly skipA11y?: boolean
  /**
   * States whose pixels depend on when the shot is taken (a skeleton mid-request)
   * are gallery-only: they are evidence, not a baseline.
   */
  readonly skipBaseline?: boolean
}

/* ── fixtures ─────────────────────────────────────────────────────── */

export function recording(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
// active (success), scheduled (primary), completed (success+check),
// failed (danger+cross), terminating (warning+spinner).
export const SESSIONS = [
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
  session({
    id: 105,
    status: "failed",
    started_at: "2026-10-11 12:00:00",
    ended_at: "2026-10-11 12:04:00",
    retry_attempts: 2,
  }),
  session({ id: 106, status: "terminating" }),
]

export const AUTORUNS = [
  autorun({ id: 201, status: "scheduled", next_run_at: "2026-10-15 09:00:00" }),
  autorun({ id: 202, status: "active" }),
]

export const RECORDINGS = [
  recording(),
  recording({ id: 302, user_friendly_name: "Morning News", snake_case_name: "morning-news" }),
]

export const PROFILES = [
  profile({ id: 401, name: "F1 Weekend" }),
  profile({ id: 402, name: "Morning News", engine_name: "FFmpeg", resolver_name: "News Feed" }),
]

export const ENGINES = [engine({ id: 1, name: "Streamlink" }), engine({ id: 2, name: "FFmpeg", origin: "user" })]

export const RESOLVERS = [
  resolver({ id: 1, name: "Wide IPTV" }),
  resolver({ id: 2, name: "News Feed", origin: "builtin" }),
]

export const SOURCES = [
  source({ id: 501, name: "Sky Sports" }),
  source({ id: 502, name: "News Feed", resolver_id: 2, resolver_name: "News Feed" }),
]

const USERS = [
  { id: 1, username: "kyros", role: "admin", display_name: "Kyros" },
  { id: 2, username: "alice", role: "user", display_name: "Alice" },
  { id: 3, username: "ghost", role: "user", display_name: "Ghost" },
]

function resourceRow(
  resourceType: string,
  id: number,
  label: string,
  viewerCount = 0,
  owner = "kyros",
): Record<string, unknown> {
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

const RESOURCES = [
  resourceRow("session", 7, "F1 Weekend", 2),
  resourceRow("autorun", 5, "F1 Race", 0, "ghost"),
  resourceRow("autorun", 6, "F2 Sprint"),
  resourceRow("profile", 401, "F1 Weekend", 1),
  resourceRow("recording", 301, "F1 Race", 0),
]

/** Everything the console needs to look like a working installation. */
const POPULATED: Partial<ApiData> = {
  sessions: SESSIONS,
  autoruns: AUTORUNS,
  recordings: RECORDINGS,
  profiles: PROFILES,
  sources: SOURCES,
  engines: ENGINES,
  resolvers: RESOLVERS,
}

/* ── reaching states that are not a URL ───────────────────────────── */

export async function openNav(page: Page, label: string): Promise<void> {
  const link = page.getByRole("link", { name: label, exact: true }).first()
  if (await link.isVisible()) {
    await link.click()
    return
  }
  // Under `sm` the sidebar is gone and the bottom bar hides secondary
  // destinations behind "More navigation".
  await page.getByRole("button", { name: "More navigation" }).click()
  await page.getByRole("menuitem", { name: label, exact: true }).click()
}

async function openSettings(page: Page): Promise<void> {
  await openNav(page, "Settings")
  await page.getByRole("heading", { level: 1, name: "Settings" }).waitFor()
}

async function openAdminSettings(page: Page): Promise<void> {
  // `admin.html` is not a route: the not-found view is the only door into the
  // shell, and it links back.
  await page.getByRole("link", { name: "Back to sessions" }).click()
  await openSettings(page)
}

/* ── the list ─────────────────────────────────────────────────────── */

export const SCENARIOS: readonly Scenario[] = [
  /* auth + chrome */
  { name: "login", path: "/login", anonymous: true },
  { name: "register", path: "/register", anonymous: true },
  { name: "not-found", path: "/definitely-not-a-route" },
  {
    name: "account-menu",
    path: "/sessions",
    data: POPULATED,
    prepare: async (page) => {
      await page.getByRole("button", { name: "Account menu" }).click()
      await page.getByRole("menu").waitFor()
    },
  },
  {
    name: "notification-drawer",
    path: "/sessions",
    data: POPULATED,
    prepare: async (page) => {
      await page.getByRole("button", { name: /^Notifications/ }).click()
      await page.getByRole("dialog").waitFor()
    },
  },

  /* sessions — every list state the surface can be in */
  { name: "sessions-list", path: "/sessions", data: { sessions: SESSIONS } },
  { name: "sessions-empty", path: "/sessions", data: { sessions: [] } },
  {
    name: "sessions-loading",
    path: "/sessions",
    data: { sessions: SESSIONS, latency: [{ path: "/sessions/", delayMs: 30_000 }] },
    settle: "immediate",
    skipBaseline: true,
    prepare: async (page) => {
      await page.getByLabel("Loading sessions").waitFor()
    },
  },
  {
    name: "sessions-error",
    path: "/sessions",
    data: {
      sessions: SESSIONS,
      // A production-shaped body: the panel renders the server's sentence, and
      // the harness's own "Stub failure" wording is not something the app would
      // ever show.
      failures: [{ path: "/sessions/", status: 500, body: { detail: "Internal Server Error" } }],
    },
    prepare: async (page) => {
      // One retry backs off for ~1s before the panel appears; shooting earlier
      // photographs the skeleton and makes "error" indistinguishable from "loading".
      await page.getByText("Something went wrong").waitFor()
    },
  },
  {
    name: "sessions-filtered-empty",
    path: "/sessions",
    data: { sessions: SESSIONS },
    prepare: async (page) => {
      await page.getByRole("textbox", { name: "Filter sessions" }).fill("no-such-session")
      await page.getByText(/no session matches/i).waitFor()
    },
  },
  { name: "session-detail", path: "/sessions/101", data: { sessions: SESSIONS } },
  {
    name: "session-detail-completed",
    path: "/sessions/104",
    data: { sessions: SESSIONS },
  },
  {
    name: "session-delete-confirm",
    path: "/sessions",
    data: { sessions: SESSIONS },
    skipA11y: true,
    prepare: async (page) => {
      // Delete is not a peer of the card any more: it lives in the one `⋯`
      // (`CMP-05`), so the confirm is two steps down.
      await page.getByRole("button", { name: "Actions for session #104" }).click()
      await page.getByRole("menuitem", { name: "Delete session #104" }).click()
      await page.getByRole("dialog").waitFor()
    },
  },
  {
    name: "new-session-empty",
    path: "/sessions",
    data: POPULATED,
    skipA11y: true,
    prepare: async (page) => {
      await page.getByRole("button", { name: "New session" }).first().click()
      await page.getByRole("dialog", { name: "New session" }).waitFor()
    },
  },
  {
    name: "new-session-profile",
    path: "/sessions",
    data: POPULATED,
    skipA11y: true,
    prepare: async (page) => {
      await page.getByRole("button", { name: "New session" }).first().click()
      const dialog = page.getByRole("dialog", { name: "New session" })
      await dialog.waitFor()
      await dialog.getByRole("combobox", { name: /^Profile/ }).selectOption("401")
      await dialog.getByRole("button", { name: "Start session" }).waitFor()
    },
  },

  /* autoruns */
  { name: "autoruns-list", path: "/autoruns", data: { autoruns: AUTORUNS } },
  { name: "autoruns-empty", path: "/autoruns", data: { autoruns: [] } },
  { name: "autorun-detail", path: "/autoruns/201", data: { autoruns: AUTORUNS } },
  {
    name: "autorun-denied",
    path: "/autoruns/201",
    data: {
      autoruns: AUTORUNS,
      failures: [
        { path: "/autoruns/201", status: 403, body: { detail: "Not your autorun" } },
      ],
    },
    prepare: async (page) => {
      await page.getByText("Something went wrong").waitFor()
    },
  },
  {
    name: "autorun-actions-menu",
    path: "/autoruns",
    data: { autoruns: AUTORUNS },
    skipA11y: true,
    prepare: async (page) => {
      await page.getByRole("button", { name: /^Actions for / }).first().click()
      await page.getByRole("menu").waitFor()
    },
  },
  {
    name: "autorun-form",
    path: "/autoruns",
    data: POPULATED,
    skipA11y: true,
    prepare: async (page) => {
      await page.getByRole("button", { name: "New autorun" }).first().click()
      await page.getByRole("dialog").waitFor()
    },
  },

  /* recordings */
  { name: "recordings-list", path: "/recordings", data: { recordings: RECORDINGS } },
  { name: "recordings-empty", path: "/recordings", data: { recordings: [] } },

  /* configure */
  {
    name: "profiles-list",
    path: "/profiles",
    data: { profiles: PROFILES, engines: ENGINES, resolvers: RESOLVERS },
  },
  {
    name: "sources-panel",
    path: "/profiles",
    data: { profiles: PROFILES, sources: SOURCES, engines: ENGINES, resolvers: RESOLVERS },
    prepare: async (page) => {
      await page.getByRole("heading", { name: /^Sources/ }).scrollIntoViewIfNeeded()
    },
  },
  {
    name: "preset-dialog",
    path: "/profiles",
    data: { profiles: PROFILES, engines: ENGINES, resolvers: RESOLVERS },
    skipA11y: true,
    prepare: async (page) => {
      // The "+" is a Fab under `sm` and the panel's "New profile" button above
      // it; both open the same dialog, whose title depends on the entry.
      const fab = page.locator("[data-slot=fab]")
      if (await fab.isVisible()) await fab.click()
      else await page.getByRole("button", { name: /^New (profile|source)/ }).first().click()
      await page.getByRole("dialog").waitFor()
    },
  },
  { name: "plugins", path: "/plugins", data: { engines: ENGINES, resolvers: RESOLVERS, profiles: PROFILES } },
  { name: "import-export", path: "/import-export" },
  { name: "settings", path: "/settings" },

  /* administration — the second build, entered the way a user enters it */
  {
    name: "admin-users",
    path: "/settings",
    admin: true,
    data: { users: USERS },
    prepare: openAdminSettings,
  },
  {
    name: "admin-resources",
    path: "/settings",
    admin: true,
    data: { users: USERS, resources: RESOURCES },
    prepare: async (page) => {
      await openAdminSettings(page)
      await page.getByRole("heading", { name: "Resource access" }).scrollIntoViewIfNeeded()
    },
  },
  {
    name: "admin-access-dialog",
    path: "/settings",
    admin: true,
    data: { users: USERS, resources: RESOURCES },
    skipA11y: true,
    prepare: async (page) => {
      await openAdminSettings(page)
      // The row's affordances live behind `⋯` now; `Manage access` is the item.
      await page.getByRole("button", { name: "Actions for F1 Weekend" }).first().click()
      await page.getByRole("menuitem", { name: "Manage access" }).click()
      await page.getByRole("dialog").waitFor()
    },
  },
  {
    name: "admin-bulk-dialog",
    path: "/autoruns",
    admin: true,
    data: {
      users: USERS,
      autoruns: [
        autorun({ id: 201, user_friendly_name: "F1 Race" }),
        autorun({ id: 202, user_friendly_name: "F2 Sprint" }),
      ],
      resources: [
        resourceRow("autorun", 201, "F1 Race", 0, "ghost"),
        resourceRow("autorun", 202, "F2 Sprint"),
      ],
    },
    skipA11y: true,
    prepare: async (page) => {
      await page.getByRole("link", { name: "Back to sessions" }).click()
      await openNav(page, "Autoruns")
      // Selection is a mode: the checkbox only exists after the toolbar toggle.
      await page.getByRole("button", { name: "Select", exact: true }).click()
      await page.getByRole("checkbox", { name: "Select F1 Race" }).check()
      await page.getByRole("button", { name: "Access", exact: true }).click()
      await page.getByRole("dialog").waitFor()
    },
  },

  /* narrow-only evidence */
  {
    name: "mobile-overflow",
    path: "/sessions",
    viewports: ["375"],
    data: {
      sessions: [
        session({
          id: 107,
          status: "completed",
          profile_name: "Sky Sports F1 — United States Grand Prix, Sprint Qualifying",
          resolver_name: "Wide IPTV With A Very Long Resolver Name",
          engine_name: "Streamlink",
          started_at: "2026-10-11 18:00:00",
          ended_at: "2026-10-11 20:30:00",
        }),
      ],
    },
  },
]

/** Navigate, pin the clock, and wait for fonts + entrance animations. */
export async function openScenario(page: Page, scenario: Scenario): Promise<void> {
  await page.clock.install()
  await page.clock.setFixedTime(FIXED_NOW)
  if (scenario.admin === true) {
    await page.goto("/admin.html")
  } else {
    await page.goto(scenario.path)
  }
  await page.waitForLoadState("load")
  if (scenario.settle === "immediate") return
  // String form on purpose: tsconfig.node has no DOM lib, so a callback that
  // references `document` fails typecheck.
  await page.evaluate("document.fonts.ready")
  await page.waitForTimeout(600)
}
