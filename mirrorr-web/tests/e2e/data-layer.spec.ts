/**
 * Data-layer acceptance specs (plan task 7).
 *
 * The auth login UI and shared storageState land in a later step, so the dev
 * API cannot be used with a real session here. Every spec seeds deterministic
 * multi-page responses through `page.route()` — the plan's sanctioned
 * client-side failure-injection approach — and asserts the hooks end to end in
 * a real browser against the app on 5175.
 */
import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"

interface ProbeRow {
  readonly id: number
  readonly status: string
  readonly engine_id: number | null
  readonly resolver_id: number | null
  readonly profile_id: number | null
}

interface SeedPage {
  readonly items: readonly ProbeRow[]
  readonly next_cursor: number | null
  readonly has_more: boolean
}

/**
 * Page 1 is deliberately out of `id` order and its last id (`9`) is the cursor
 * into page 2, which is unsorted too. Page 1: [7,3,12,5,9], page 2:
 * [11,19,8,1,13]; merged `id` desc must be 19,13,12,11,9,8,7,5,3,1.
 * Session 7 references engine 99, which no catalog contains -> muted `#99`.
 */
const SESSION_PAGES: readonly SeedPage[] = [
  {
    items: [
      { id: 7, status: "completed", engine_id: 99, resolver_id: null, profile_id: 1 },
      { id: 3, status: "failed", engine_id: 1, resolver_id: 1, profile_id: 1 },
      { id: 12, status: "completed", engine_id: 1, resolver_id: 2, profile_id: 2 },
      { id: 5, status: "failed", engine_id: 2, resolver_id: null, profile_id: 2 },
      { id: 9, status: "completed", engine_id: 3, resolver_id: 1, profile_id: null },
    ],
    next_cursor: 9,
    has_more: true,
  },
  {
    items: [
      { id: 11, status: "failed", engine_id: 2, resolver_id: 2, profile_id: 1 },
      { id: 19, status: "completed", engine_id: 3, resolver_id: 1, profile_id: 2 },
      { id: 8, status: "failed", engine_id: 1, resolver_id: null, profile_id: null },
      { id: 1, status: "completed", engine_id: 2, resolver_id: 1, profile_id: 1 },
      { id: 13, status: "completed", engine_id: 1, resolver_id: 2, profile_id: 1 },
    ],
    next_cursor: null,
    has_more: false,
  },
]

const CATALOGS: Readonly<Record<string, readonly { id: number; name: string }[]>> = {
  engines: [
    { id: 1, name: "Engine Alpha" },
    { id: 2, name: "Engine Beta" },
    { id: 3, name: "Engine Gamma" },
  ],
  resolvers: [
    { id: 1, name: "Resolver One" },
    { id: 2, name: "Resolver Two" },
  ],
  profiles: [
    { id: 1, name: "Profile Default" },
    { id: 2, name: "Profile Alt" },
  ],
}

interface SessionRequestRecord {
  readonly cursor: number | null
}

interface SeedOptions {
  /** Delay applied only to the cursor page, so loading states stay observable. */
  readonly secondPageDelayMs?: number
}

/**
 * Stubs `/api/sessions/` (cursor -> page mapping, Cache-Control: no-store) and
 * the three name catalogs. Returns the recorded session requests so specs can
 * assert which cursors were fetched.
 */
async function seedDataLayer(page: Page, options: SeedOptions = {}): Promise<SessionRequestRecord[]> {
  const requests: SessionRequestRecord[] = []

  await page.route("**/api/sessions/*", async (route) => {
    const url = new URL(route.request().url())
    const cursorParam = url.searchParams.get("cursor")
    requests.push({ cursor: cursorParam === null ? null : Number(cursorParam) })

    const pageIndex = cursorParam === null ? 0 : Number(cursorParam) === 9 ? 1 : -1
    if (pageIndex === -1) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ detail: `unexpected cursor ${cursorParam}` }),
      })
      return
    }

    if (pageIndex === 1 && options.secondPageDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.secondPageDelayMs))
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "cache-control": "no-store" },
      body: JSON.stringify(SESSION_PAGES[pageIndex]),
    })
  })

  for (const [kind, items] of Object.entries(CATALOGS)) {
    await page.route(`**/api/${kind}/*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
        body: JSON.stringify({ items, next_cursor: null, has_more: false }),
      }),
    )
  }

  return requests
}

async function rowIds(page: Page): Promise<(string | null)[]> {
  return page
    .getByTestId("probe-row")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-id")))
}

async function expectRowIds(page: Page, expected: readonly string[]): Promise<void> {
  await expect.poll(() => rowIds(page)).toEqual(expected)
}

async function gotoProbe(page: Page): Promise<void> {
  await page.goto("/dev/data-probe")
  await expect(page.getByTestId("probe-row")).toHaveCount(5)
}

async function scrollToSentinel(page: Page): Promise<void> {
  await page
    .getByTestId("data-probe-scroll")
    .evaluate((element) => element.scrollTo({ top: element.scrollHeight }))
}

test.describe("data layer", () => {
  test("renders out-of-order pages sorted by id desc and auto-loads on scroll", async ({ page }) => {
    const requests = await seedDataLayer(page)
    await gotoProbe(page)

    await expectRowIds(page, ["12", "9", "7", "5", "3"])
    await expect(page.getByTestId("showing-count")).toHaveText("Showing 5+")
    await expect(page.getByTestId("probe-row").first().getByTestId("engine-name")).toHaveText("Engine Alpha")

    await scrollToSentinel(page)

    await expect(page.getByTestId("probe-row")).toHaveCount(10)
    await expectRowIds(page, ["19", "13", "12", "11", "9", "8", "7", "5", "3", "1"])
    await expect(page.getByTestId("showing-count")).toHaveText("Showing 10")
    // Dev React StrictMode double-mounts, so the first page can be fetched
    // twice; what matters is that the next-page request is exactly cursor 9.
    const cursors = requests.map((request) => request.cursor)
    expect(cursors).toContain(null)
    expect(cursors.filter((cursor) => cursor !== null)).toEqual([9])
    expect(cursors.at(-1)).toBe(9)
  })

  test("Load more click follows next_cursor and merges id desc", async ({ page }) => {
    const requests = await seedDataLayer(page)
    await gotoProbe(page)

    await page.getByTestId("load-more").click()

    await expect(page.getByTestId("probe-row")).toHaveCount(10)
    await expectRowIds(page, ["19", "13", "12", "11", "9", "8", "7", "5", "3", "1"])
    const cursors = requests.map((request) => request.cursor)
    expect(cursors.filter((cursor) => cursor !== null)).toEqual([9])
    expect(cursors.at(-1)).toBe(9)
  })

  test("a filter change resets pagination to a fresh key instead of merging stale pages", async ({ page }) => {
    const requests = await seedDataLayer(page)
    await gotoProbe(page)
    await scrollToSentinel(page)
    await expect(page.getByTestId("probe-row")).toHaveCount(10)

    const before = requests.length
    await page.getByTestId("probe-status").selectOption("failed")

    await expectRowIds(page, ["11", "8", "5", "3"])
    await expect(page.getByTestId("showing-count")).toHaveText("Showing 4")

    const after = requests.slice(before)
    expect(after[0]?.cursor, "filter change must start from a fresh first page").toBeNull()
    expect(after.some((request) => request.cursor === 9), "non-all filter still exhausts pages").toBe(true)
  })

  test("disclosure and Load all appear only while has_more with a filter active", async ({ page }) => {
    const requests = await seedDataLayer(page)
    await gotoProbe(page)

    await expect(page.getByTestId("filter-disclosure")).toHaveCount(0)

    await page.getByTestId("probe-search").fill("completed")

    await expect(page.getByTestId("filter-disclosure")).toBeVisible()
    await expect(page.getByTestId("filter-hint")).toHaveText("Filter applies to loaded rows")
    await expect(page.getByTestId("showing-count")).toHaveText("Showing 3+")
    await expectRowIds(page, ["12", "9", "7"])

    await page.getByTestId("load-all").click()

    await expect(page.getByTestId("filter-disclosure")).toHaveCount(0)
    await expect(page.getByTestId("showing-count")).toHaveText("Showing 6")
    await expectRowIds(page, ["19", "13", "12", "9", "7", "1"])
    const cursors = requests.map((request) => request.cursor)
    expect(cursors.filter((cursor) => cursor !== null)).toEqual([9])
  })

  test("a non-all status filter auto-exhausts pagination before presenting results", async ({ page }) => {
    const requests = await seedDataLayer(page, { secondPageDelayMs: 600 })
    await gotoProbe(page)

    await page.getByTestId("probe-status").selectOption("completed")

    await expect(page.getByTestId("auto-exhausting")).toBeVisible()
    await expect(page.getByTestId("probe-row")).toHaveCount(0)

    await expect(page.getByTestId("auto-exhausting")).toHaveCount(0, { timeout: 10_000 })
    await expectRowIds(page, ["19", "13", "12", "9", "7", "1"])
    await expect(page.getByTestId("showing-count")).toHaveText("Showing 6")
    expect(requests.some((request) => request.cursor === 9)).toBe(true)
  })

  test("a missing name id renders muted #<id> while resolved names use secondary text", async ({ page }) => {
    await seedDataLayer(page)
    await gotoProbe(page)

    const missingCell = page.locator('[data-testid="probe-row"][data-id="7"] [data-testid="engine-name"]')
    await expect(missingCell).toHaveText("#99")
    const missingColor = await missingCell.evaluate((element) => getComputedStyle(element).color)
    expect(missingColor).toBe("rgb(126, 135, 152)")

    const resolvedCell = page.locator('[data-testid="probe-row"][data-id="12"] [data-testid="engine-name"]')
    await expect(resolvedCell).toHaveText("Engine Alpha")
    const resolvedColor = await resolvedCell.evaluate((element) => getComputedStyle(element).color)
    expect(resolvedColor).toBe("rgb(154, 163, 178)")
  })
})
