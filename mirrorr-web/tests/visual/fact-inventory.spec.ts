import type { Locator, Page } from "@playwright/test"
import { expect, test, type ApiData } from "../e2e/fixtures"
import { autorun, engine, profile, resolver, session } from "../e2e/fixtures"
import { FIXED_NOW, openNav, openScenario } from "./scenarios"

/**
 * Fact-inventory gate (§7 of `docs/ux-audit/plan.md`).
 *
 * The card rework is allowed to change hierarchy, grouping and copy — it is NOT
 * allowed to silently drop a value the current card renders. This file is the
 * executable list of those values: one entry per fact, one assertion that proves
 * it is still on the card (or one line saying where a disclosure now holds it).
 *
 * When a phase moves a fact, **edit its `home`**; when a phase deletes a fact,
 * the test must fail first. That is the whole mechanism — a review note cannot
 * do this, because nobody re-reads a review note when rewriting a card.
 *
 * Deliberately value-based, not class-based: it must survive the rewrite of every
 * component it guards.
 */

interface Fact {
  /** Stable name for the fact, used in the failure message. */
  readonly key: string
  /** Where the value lives today; a future disclosure states its new home here. */
  readonly home: string
  readonly check: (card: Locator) => Promise<void>
}

const text = (value: string) => async (card: Locator): Promise<void> => {
  await expect(card.getByText(value, { exact: false }).first()).toBeVisible()
}

const labelled = (name: string | RegExp) => async (card: Locator): Promise<void> => {
  await expect(card.getByLabel(name).first()).toBeVisible()
}

const media = () => async (card: Locator): Promise<void> => {
  await expect(card.locator("[data-card-ignore]").first()).toBeVisible()
}

/**
 * The access affordance is contributed by the admin entry only, so these three
 * surfaces are inventoried through `admin.html` — otherwise the gate would claim
 * a build has no access action when the build that has one was never opened.
 */
async function enterAdmin(page: Page, destination: string): Promise<void> {
  await page.getByRole("link", { name: "Back to sessions" }).click()
  await openNav(page, destination)
}

/** `formatBytes(2_147_483_648)` → "2.0 GB"; the exact digits are not the point, the value is. */
const SIZE = "2.0 GB"

/* ── fixtures: one row per surface, every optional field populated ─── */

const SESSION_ROW = session({
  id: 101,
  status: "recording",
  recording: true,
  profile_name: "F1 Weekend",
  resolver_name: "Wide IPTV",
  engine_name: "Streamlink",
  started_at: "2026-10-12 08:12:00",
  session_urls: [{ label: "M3U8", url: "https://example.test/content/sessions/101/stream.m3u8" }],
})

const AUTORUN_ROW = autorun({
  id: 201,
  user_friendly_name: "F1 Race",
  snake_case_name: "f1-race",
  profile_name: "F1 Weekend",
  resolver_name: "Wide IPTV",
  engine_name: "Streamlink",
  status: "scheduled",
  recording: true,
  start_time: "2026-10-15 09:00:00",
  end_time: "2026-10-15 11:00:00",
})

const RECORDING_ROW = {
  id: 301,
  user_friendly_name: "F1 Race",
  snake_case_name: "f1-race",
  content_url: "https://example.test/content/f1-race/recording.mp4",
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
}

const DATA: Partial<ApiData> = {
  sessions: [SESSION_ROW],
  autoruns: [AUTORUN_ROW],
  recordings: [RECORDING_ROW],
  profiles: [profile({ id: 401, name: "F1 Weekend" })],
  engines: [engine({ id: 1, name: "Streamlink" })],
  resolvers: [resolver({ id: 1, name: "Wide IPTV" })],
}

/** The month/day the window box must show, computed the way the app formats it. */
const WINDOW_DATE = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
}).format(new Date(Date.UTC(2026, 9, 15, 9, 0)))

/* ── sessions ─────────────────────────────────────────────────────── */

const SESSION_FACTS: readonly Fact[] = [
  { key: "id", home: "title row, `#id`", check: text("#101") },
  { key: "title", home: "title row (profile name today)", check: text("F1 Weekend") },
  { key: "status", home: "header chip", check: text("Recording") },
  { key: "live-marker", home: "hero label", check: text("Live") },
  { key: "resolver → engine", home: "source line", check: text("Wide IPTV") },
  { key: "engine", home: "source line", check: text("Streamlink") },
  { key: "profile", home: "meta line", check: text("F1 Weekend") },
  {
    key: "started-at",
    home: "meta line (local date/time, or `not started`)",
    check: async (card) => {
      await expect(card.getByText(/\d{1,2}:\d{2}/).first()).toBeVisible()
    },
  },
  { key: "media", home: "preview box (`data-card-ignore`)", check: media() },
  { key: "published-url", home: "detail block (label · stripped URL · copy)", check: text("/content/sessions/101/stream.m3u8") },
  { key: "url-label", home: "detail block label (as published by the core: HTML/M3U8/VLC/Session)", check: text("M3U8") },
  { key: "access-action", home: "header action cluster (admin build)", check: labelled("Access for F1 Weekend") },
  { key: "stop-action", home: "footer (recording state)", check: labelled("Stop recording session #101") },
  {
    key: "select",
    home: "header checkbox, after the toolbar `Select` toggle",
    check: async (card) => {
      await card.page().getByRole("button", { name: "Select", exact: true }).click()
      await expect(card.getByLabel("Select session #101")).toBeVisible()
    },
  },
]

test("fact inventory · session card renders every value it renders today", async ({ page, api }) => {
  Object.assign(api.data, DATA)
  await openScenario(page, { name: "sessions", path: "/sessions", admin: true, data: DATA })
  await enterAdmin(page, "Sessions")
  const card = page.locator("article").filter({ hasText: "#101" }).first()
  await expect(card).toBeVisible()

  const missing: string[] = []
  for (const fact of SESSION_FACTS) {
    try {
      await fact.check(card)
    } catch {
      missing.push(`${fact.key} (home: ${fact.home})`)
    }
  }
  expect(missing).toEqual([])
})

/* ── autoruns ─────────────────────────────────────────────────────── */

const AUTORUN_FACTS: readonly Fact[] = [
  { key: "name", home: "identity line, name link", check: text("F1 Race") },
  { key: "slug", home: "identity line, tag", check: text("f1-race") },
  {
    key: "window-date",
    home: "detail block, first line",
    check: async (card) => {
      await expect(card.getByText(WINDOW_DATE, { exact: false }).first()).toBeVisible()
    },
  },
  {
    key: "window-time + tz label",
    home: "detail block, second line + zone label",
    check: async (card) => {
      await expect(card.getByText(/\d{1,2}:\d{2}/).first()).toBeVisible()
      await expect(card.locator('[data-slot="detail"] [data-zone-label]')).toHaveText(/\S/)
    },
  },
  {
    key: "countdown",
    home: "hero",
    check: async (card) => {
      await expect(card.getByText(/starts in ~/).first()).toBeVisible()
    },
  },
  { key: "resolver", home: "identity meta line", check: text("Wide IPTV") },
  { key: "engine", home: "identity meta line", check: text("Streamlink") },
  { key: "profile", home: "identity meta line", check: text("F1 Weekend") },
  { key: "status", home: "header chip", check: text("Scheduled") },
  { key: "recording-marker", home: "header `REC` tag", check: text("REC") },
  { key: "access-action", home: "header action cluster (admin build)", check: labelled("Access for F1 Race") },
  { key: "actions-menu", home: "header action cluster `⋯`", check: labelled("Actions for F1 Race") },
  {
    key: "select",
    home: "select-mode checkbox (after the toolbar `Select` toggle)",
    check: async (card) => {
      await card.page().getByRole("button", { name: "Select", exact: true }).click()
      await expect(card.getByLabel("Select F1 Race")).toBeVisible()
    },
  },
]

test("fact inventory · autorun card renders every value it renders today", async ({ page, api }) => {
  api.data.sessions = []
  api.data.autoruns = [AUTORUN_ROW]
  api.data.profiles = DATA.profiles
  api.data.engines = DATA.engines
  api.data.resolvers = DATA.resolvers
  await openScenario(page, { name: "autoruns", path: "/autoruns", admin: true, data: DATA })
  await enterAdmin(page, "Autoruns")
  const card = page.locator("article").filter({ hasText: "f1-race" }).first()
  await expect(card).toBeVisible()

  const missing: string[] = []
  for (const fact of AUTORUN_FACTS) {
    try {
      await fact.check(card)
    } catch {
      missing.push(`${fact.key} (home: ${fact.home})`)
    }
  }
  expect(missing).toEqual([])
})

/* ── recordings ───────────────────────────────────────────────────── */

const RECORDING_FACTS: readonly Fact[] = [
  { key: "name", home: "title row link", check: text("F1 Race") },
  { key: "id", home: "title row, `#id`", check: text("#301") },
  { key: "slug", home: "header tag", check: text("f1-race") },
  { key: "duration", home: "hero (and the plate when unserved)", check: text("2:30:00") },
  { key: "resolver", home: "identity meta row", check: text("Wide IPTV") },
  { key: "engine", home: "identity meta row", check: text("Streamlink") },
  { key: "profile", home: "identity meta row", check: text("F1 Weekend") },
  { key: "session-link", home: "identity meta row → `Session #103`", check: text("Session #103") },
  { key: "size", home: "identity meta row", check: text(SIZE) },
  {
    key: "created-at",
    home: "identity meta row",
    check: async (card) => {
      await expect(card.getByText(/\d{1,2}:\d{2}/).first()).toBeVisible()
    },
  },
  { key: "media", home: "preview box (`data-card-ignore`)", check: media() },
  { key: "file-url", home: "detail line (stripped path, full URL in `title`)", check: text("/content/f1-race/recording.mp4") },
  { key: "access-action", home: "header action cluster (admin build)", check: labelled("Access for F1 Race") },
  {
    key: "open-action",
    home: "whole card (mouse); `Download recording #301` is the keyboard path",
    check: labelled("Download recording #301"),
  },
  {
    key: "delete-action",
    home: "header `⋯` menu",
    check: async (card) => {
      await card.getByLabel("Actions for recording #301").click()
      await expect(card.getByRole("menuitem", { name: "Delete recording #301" })).toBeVisible()
    },
  },
  {
    key: "select",
    home: "header checkbox, after the toolbar `Select` toggle",
    check: async (card) => {
      await card.page().getByRole("button", { name: "Select", exact: true }).click()
      await expect(card.getByLabel("Select F1 Race")).toBeVisible()
    },
  },
]

test("fact inventory · recording card renders every value it renders today", async ({ page, api }) => {
  api.data.sessions = []
  api.data.autoruns = []
  api.data.recordings = [RECORDING_ROW]
  await openScenario(page, {
    name: "recordings",
    path: "/recordings",
    admin: true,
    data: { recordings: [RECORDING_ROW] },
  })
  await enterAdmin(page, "Recordings")
  const card = page.locator("article").filter({ hasText: "#301" }).first()
  await expect(card).toBeVisible()

  const missing: string[] = []
  for (const fact of RECORDING_FACTS) {
    try {
      await fact.check(card)
    } catch {
      missing.push(`${fact.key} (home: ${fact.home})`)
    }
  }
  expect(missing).toEqual([])
})

// The settled rule (`TimeText`): a card prints the viewer's clock and never
// claims a zone, and the page names the zone once — repeating it on every card
// is noise, naming it nowhere is the bug that read an autorun an hour early
// across a DST change.
test("fact inventory · time is shown in the viewer's zone and named once per page", async ({ page, api }) => {
  api.data.sessions = [SESSION_ROW]
  await openScenario(page, { name: "sessions", path: "/sessions", data: DATA })
  const card = page.locator("article").filter({ hasText: "#101" }).first()
  const cardText = await card.innerText()
  expect(cardText).not.toMatch(/stored utc|\bUTC\b/i)
  // The clock the card prints is the one a browser in any zone would print.
  const expected = await page.evaluate(
    (iso) =>
      new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(iso)),
    "2026-10-12T08:12:00Z",
  )
  expect(cardText).toContain(expected)
  // Named once, by the page, for every time under it.
  const note = page.locator("[data-slot=time-zone-note]")
  expect(await note.count()).toBe(1)
  expect(await note.innerText()).toMatch(/^Times in /)
  expect(FIXED_NOW.toISOString()).toContain("2026-10-12")
})
