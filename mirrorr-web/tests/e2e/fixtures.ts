import { expect, test as base, type Page } from "@playwright/test"

/**
 * Shared Playwright fixture module. Specs must import `test` from here, never
 * from `@playwright/test` directly.
 *
 * The `appShell` auto-fixture is the global precondition: before every spec,
 * it navigates via the config `baseURL` (relative `goto("/")`) and asserts the
 * greenfield app marker. The legacy app serves the same `<title>Mirrorr</title>`
 * but has no `data-app="mirrorr-web"` marker, so a stale/legacy server cannot
 * satisfy this precondition.
 */
export const test = base.extend<{ appShell: void }>({
  appShell: [
    async ({ page }, use) => {
      const response = await page.goto("/")

      expect(response?.status(), "precondition: GET / must answer 200").toBe(200)
      await expect(page.locator('[data-app="mirrorr-web"]')).toHaveCount(1)

      await use()
    },
    { auto: true },
  ],
})

export { expect } from "@playwright/test"

/**
 * Catalogue stubs for specs that render V3 with synthetic rows: the sessions
 * list resolves engine/resolver/profile names through the memo-map, so those
 * collections must answer even when the session payload carries `_name`s.
 */
export const ENGINE_ITEM = {
  id: 1,
  name: "yt_dlp_piped",
  capabilities: { can_record: true, can_playlist: true },
  retry_modes_schema: {
    none: { default_params: {} },
    count: { default_params: { count: 3, delay: 5 } },
  },
}

export const RESOLVER_ITEM = {
  id: 1,
  name: "static",
  config_schema: {
    type: "object",
    properties: { url: { type: "string", title: "Url" } },
    required: ["url"],
  },
}

export const PROFILE_ITEM = {
  id: 9,
  name: "p2",
  default_engine_id: 1,
  resolver_id: 1,
  resolver_config: { url: "https://example.com/original.m3u8" },
  retry_mode: "none",
  retry_config: {},
}

export interface SessionSeed {
  readonly id: number
  readonly status: string
  readonly engine_id?: number
  readonly resolver_id?: number
  readonly profile_id?: number | null
  readonly autorun_id?: number | null
  readonly recording?: boolean
  readonly started_at?: string | null
  readonly ended_at?: string | null
  readonly requester_user_token?: string | null
}

function cursorBody(items: readonly unknown[]): string {
  return JSON.stringify({ items, next_cursor: null, has_more: false })
}

/** Answers `GET /api/sessions/` with one full page; everything else falls through. */
export async function stubSessionList(page: Page, sessions: readonly SessionSeed[]): Promise<void> {
  await page.route("**/api/sessions/**", async (route) => {
    const request = route.request()
    if (request.method() !== "GET" || new URL(request.url()).pathname !== "/api/sessions/") {
      await route.fallback()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: cursorBody(sessions),
    })
  })
}

/** Answers the three catalogues the name map and D1 read. */
export async function stubCatalogs(page: Page): Promise<void> {
  await page.route("**/api/**", async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (request.method() === "GET" && pathname === "/api/engines/") {
      await route.fulfill({ status: 200, contentType: "application/json", body: cursorBody([ENGINE_ITEM]) })
      return
    }
    if (request.method() === "GET" && pathname === "/api/resolvers/") {
      await route.fulfill({ status: 200, contentType: "application/json", body: cursorBody([RESOLVER_ITEM]) })
      return
    }
    if (request.method() === "GET" && pathname === "/api/profiles/") {
      await route.fulfill({ status: 200, contentType: "application/json", body: cursorBody([PROFILE_ITEM]) })
      return
    }
    await route.fallback()
  })
}
