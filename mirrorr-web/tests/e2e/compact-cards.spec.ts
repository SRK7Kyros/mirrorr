import { mkdirSync } from "node:fs"
import path from "node:path"
import { expect, test, stubCatalogs, stubSessionList, type SessionSeed } from "./fixtures"

/**
 * Todo 26 / spec L516 "card list, fixed anatomy", L539-L541 "card tap opens the
 * detail; a single 44px ⋮ opens a bottom action sheet", L558 "ActionSheet is a
 * presentation wrapper, not a new action model".
 *
 * The rows are stubbed so the assertions are deterministic and independent of
 * whatever the dev core happens to hold.
 */
const EVIDENCE_DIR = path.resolve(import.meta.dirname, "../../../.omo/evidence")

const CARD_FLOOR_PX = 64
const TARGET_FLOOR_PX = 44

const ROWS: readonly SessionSeed[] = [
  {
    id: 701,
    status: "active",
    engine_id: 1,
    resolver_id: 1,
    profile_id: 9,
    recording: false,
    started_at: "2026-09-19T10:00:00",
    ended_at: null,
  },
]

function nonEmpty(labels: readonly string[]): string[] {
  return labels.map((label) => label.trim()).filter((label) => label.length > 0)
}

test.describe("compact card list at 390x844", () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test("sessions renders cards instead of a table, and the sheet carries the desktop action set", async ({
    page,
  }) => {
    await stubSessionList(page, ROWS)
    await stubCatalogs(page)

    await page.goto("/sessions")
    await expect(page.getByTestId("sessions-view")).toBeVisible()

    await expect(page.getByTestId("compact-card-list")).toBeVisible()
    await expect(page.locator("table")).toHaveCount(0)

    const card = page.getByTestId("compact-card").filter({ hasText: "#701" })
    await expect(card).toHaveCount(1)

    const cardBox = await card.boundingBox()
    const overflowBox = await card.getByTestId("compact-card-overflow").boundingBox()
    expect(cardBox).not.toBeNull()
    expect(overflowBox).not.toBeNull()
    expect(Math.round(cardBox?.height ?? 0)).toBeGreaterThanOrEqual(CARD_FLOOR_PX)
    expect(Math.round(overflowBox?.height ?? 0)).toBeGreaterThanOrEqual(TARGET_FLOOR_PX)
    expect(Math.round(overflowBox?.width ?? 0)).toBeGreaterThanOrEqual(TARGET_FLOOR_PX)

    mkdirSync(EVIDENCE_DIR, { recursive: true })
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-26-compact-cards-390x844.png") })

    await card.getByTestId("compact-card-overflow").click()
    const sheet = page.getByTestId("action-sheet")
    await expect(sheet).toBeVisible()
    const sheetLabels = nonEmpty(await sheet.getByRole("button").allTextContents()).sort()
    expect(sheetLabels.length).toBeGreaterThan(0)

    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-26-compact-actions-390x844.png") })
    await page.keyboard.press("Escape")
    await expect(sheet).toHaveCount(0)

    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto("/sessions")

    const row = page.getByTestId("table-row").filter({ hasText: "#701" })
    await expect(row).toBeVisible()
    await expect(page.getByTestId("compact-card-list")).toHaveCount(0)

    const inlineLabels = nonEmpty(await row.getByRole("button").allTextContents())
    const moreButton = row.getByRole("button", { name: /^More actions for session/ })
    let overflowLabels: string[] = []
    if ((await moreButton.count()) > 0) {
      await moreButton.click()
      overflowLabels = nonEmpty(await page.getByTestId("row-overflow-menu").getByRole("menuitem").allTextContents())
    }

    expect(sheetLabels).toEqual([...inlineLabels, ...overflowLabels].sort())
  })

  test("autoruns renders cards whose sheet adds Export to the desktop action set", async ({ page }) => {
    await page.route("**/api/autoruns/**", async (route) => {
      const request = route.request()
      if (request.method() !== "GET" || new URL(request.url()).pathname !== "/api/autoruns/") {
        await route.fallback()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Cache-Control": "no-store" },
        body: JSON.stringify({
          items: [
            {
              id: 811,
              status: "scheduled",
              user_friendly_name: "Evening news",
              snake_case_name: "evening_news",
              engine_id: 1,
              resolver_id: 1,
              start_time: "2026-09-21T10:00:00",
              end_time: "2026-09-21T11:00:00",
              recording: false,
            },
          ],
          next_cursor: null,
          has_more: false,
        }),
      })
    })
    await stubCatalogs(page)

    await page.goto("/autoruns")
    await expect(page.getByTestId("autoruns-view")).toBeVisible()
    await expect(page.getByTestId("compact-card-list")).toBeVisible()
    await expect(page.locator("table")).toHaveCount(0)

    const card = page.getByTestId("compact-card").filter({ hasText: "Evening news" })
    await expect(card).toHaveCount(1)
    const cardBox = await card.boundingBox()
    expect(Math.round(cardBox?.height ?? 0)).toBeGreaterThanOrEqual(CARD_FLOOR_PX)

    await card.getByTestId("compact-card-overflow").click()
    const sheet = page.getByTestId("action-sheet")
    await expect(sheet).toBeVisible()
    const sheetLabels = nonEmpty(await sheet.getByRole("button").allTextContents()).sort()
    expect(sheetLabels).toContain("Export")

    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-26-compact-autorun-actions-390x844.png") })
    await page.keyboard.press("Escape")
    await expect(sheet).toHaveCount(0)

    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto("/autoruns")

    const row = page.getByTestId("table-row").filter({ hasText: "Evening news" })
    await expect(row).toBeVisible()
    await expect(page.getByTestId("compact-card-list")).toHaveCount(0)

    const inlineLabels = nonEmpty(await row.getByRole("button").allTextContents())
    const moreButton = row.getByRole("button", { name: /^More actions for autorun/ })
    let overflowLabels: string[] = []
    if ((await moreButton.count()) > 0) {
      await moreButton.click()
      overflowLabels = nonEmpty(await page.getByTestId("row-overflow-menu").getByRole("menuitem").allTextContents())
    }

    expect(sheetLabels).toEqual([...inlineLabels, ...overflowLabels].sort())
  })

  test("profiles renders cards whose sheet exposes the profile action set", async ({ page }) => {
    await stubCatalogs(page)

    await page.goto("/profiles")
    await expect(page.getByTestId("profiles-view")).toBeVisible()
    await expect(page.getByTestId("compact-card-list")).toBeVisible()
    await expect(page.locator("table")).toHaveCount(0)

    const card = page.getByTestId("compact-card").filter({ hasText: "p2" })
    await expect(card).toHaveCount(1)
    const cardBox = await card.boundingBox()
    expect(Math.round(cardBox?.height ?? 0)).toBeGreaterThanOrEqual(CARD_FLOOR_PX)

    await card.getByTestId("compact-card-overflow").click()
    const sheet = page.getByTestId("action-sheet")
    await expect(sheet).toBeVisible()
    expect(nonEmpty(await sheet.getByRole("button").allTextContents())).toEqual(["Use", "Edit", "Export", "Delete"])

    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-26-compact-profiles-390x844.png") })
    await page.keyboard.press("Escape")
    await expect(sheet).toHaveCount(0)

    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto("/profiles")

    const row = page.getByTestId("table-row").filter({ hasText: "p2" })
    await expect(row).toBeVisible()
    await expect(page.getByTestId("compact-card-list")).toHaveCount(0)
    await expect(row.getByRole("button")).toHaveCount(4)
  })
})
