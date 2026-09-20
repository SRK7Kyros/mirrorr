import { expect, test, stubCatalogs, stubSessionList, type SessionSeed } from "./fixtures"

/**
 * Todo 31 acceptance (spec L114-L139, endpoint coverage L410-L467): the built app
 * consults the id->name memo map instead of fetching per row, and never touches the
 * endpoints the spec marks Reserved/Unused. This is measured from the network log
 * of a real walk, not from reading the source.
 */
const SESSION_SEED: readonly SessionSeed[] = [
  {
    id: 701,
    status: "recording",
    engine_id: 1,
    resolver_id: 1,
    profile_id: 9,
    recording: true,
    started_at: "2026-09-19T10:00:00",
    ended_at: null,
  },
]

const AUTORUN_ROW = {
  id: 811,
  status: "scheduled",
  user_friendly_name: "Evening news",
  snake_case_name: "evening_news",
  engine_id: 1,
  resolver_id: 1,
  start_time: "2026-09-21T10:00:00",
  end_time: "2026-09-21T11:00:00",
  recording: false,
}

/** Reserved/Unused per spec L410-L467: detail routes the client must never call. */
const RESERVED_DETAIL = /^\/api\/(recordings|engines|resolvers|notifications)\/\d+$/
/** Per-row name lookups: names come from the list pages via the memo map. */
const PER_ROW_NAME = /^\/api\/(engines|resolvers|profiles)\/\d+$/

const WALK = ["/sessions", "/sessions/701", "/autoruns", "/autoruns/811", "/recordings", "/profiles", "/plugins"]

test.describe("request savings at 1280x800", () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test("the walk fetches lists, never reserved detail endpoints or per-row names", async ({
    page,
  }) => {
    test.setTimeout(120_000)

    const paths: string[] = []
    page.on("request", (request) => {
      const url = new URL(request.url())
      if (url.pathname.startsWith("/api/")) paths.push(url.pathname)
    })

    await stubSessionList(page, SESSION_SEED)
    await stubCatalogs(page)
    await page.route("**/api/sessions/701", (route) => {
      if (route.request().method() !== "GET") return route.fallback()
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Cache-Control": "no-store" },
        body: JSON.stringify({ ...SESSION_SEED[0], session_urls: [] }),
      })
    })
    await page.route("**/api/autoruns/**", (route) => {
      if (route.request().method() !== "GET") return route.fallback()
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Cache-Control": "no-store" },
        body: JSON.stringify(AUTORUN_ROW),
      })
    })
    // The dev core answers an unauthenticated socket with 4001, which the app
    // correctly reads as an expired session; a held-open mock keeps the stream live.
    await page.routeWebSocket(/\/ws\//, () => undefined)

    for (const path of WALK) {
      await page.goto(path)
      await page.waitForLoadState("networkidle")
    }

    const reserved = paths.filter((path) => RESERVED_DETAIL.test(path))
    const perRow = paths.filter((path) => PER_ROW_NAME.test(path))
    console.log(`savings: ${paths.length} api requests over ${WALK.length} views`)
    console.log(`savings: list pages ${JSON.stringify([...new Set(paths)].filter((p) => p.endsWith("/")))}`)

    expect(reserved, "no reserved detail endpoint was fetched").toEqual([])
    expect(perRow, "no per-row name lookup was fetched").toEqual([])
    // The memo map is fed by the list pages, so those must have been consulted.
    expect(paths).toContain("/api/engines/")
    expect(paths).toContain("/api/profiles/")
  })
})
