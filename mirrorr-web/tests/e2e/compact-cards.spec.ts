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

  test("settings users renders cards whose sheet exposes Delete", async ({ page }) => {
    await page.goto("/settings/users")
    await expect(page.getByTestId("settings-users-view")).toBeVisible()
    await expect(page.getByTestId("compact-card-list")).toBeVisible()
    await expect(page.locator("table")).toHaveCount(0)

    const card = page.getByTestId("compact-card").first()
    await expect(card).toBeVisible()
    const cardBox = await card.boundingBox()
    expect(Math.round(cardBox?.height ?? 0)).toBeGreaterThanOrEqual(CARD_FLOOR_PX)

    await card.getByTestId("compact-card-overflow").click()
    const sheet = page.getByTestId("action-sheet")
    await expect(sheet).toBeVisible()
    expect(nonEmpty(await sheet.getByRole("button").allTextContents())).toEqual(["Delete"])

    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-26-compact-settings-users-390x844.png") })
    await page.keyboard.press("Escape")
    await expect(sheet).toHaveCount(0)

    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto("/settings/users")
    await expect(page.locator("table")).toHaveCount(1)
    await expect(page.getByTestId("compact-card-list")).toHaveCount(0)
  })

  test("settings clients renders cards whose sheet exposes Revoke", async ({ page }) => {
    await page.route("**/api/auth/clients", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Cache-Control": "no-store" },
        body: JSON.stringify([{ id: 41, name: "ci-bot", created_at: "2026-09-01T00:00:00", is_active: true }]),
      })
    })

    await page.goto("/settings/clients")
    await expect(page.getByTestId("settings-clients-view")).toBeVisible()
    await expect(page.getByTestId("compact-card-list")).toBeVisible()
    await expect(page.locator("table")).toHaveCount(0)

    const card = page.getByTestId("compact-card").filter({ hasText: "ci-bot" })
    await expect(card).toHaveCount(1)
    const cardBox = await card.boundingBox()
    expect(Math.round(cardBox?.height ?? 0)).toBeGreaterThanOrEqual(CARD_FLOOR_PX)

    await card.getByTestId("compact-card-overflow").click()
    const sheet = page.getByTestId("action-sheet")
    await expect(sheet).toBeVisible()
    expect(nonEmpty(await sheet.getByRole("button").allTextContents())).toEqual(["Revoke"])

    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-26-compact-settings-clients-390x844.png") })
    await page.keyboard.press("Escape")
    await expect(sheet).toHaveCount(0)

    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto("/settings/clients")
    await expect(page.locator("table")).toHaveCount(1)
    await expect(page.getByTestId("compact-card-list")).toHaveCount(0)
  })

  test("a wizard opens as a full-screen panel with a sticky header", async ({ page }) => {
    await page.goto("/autoruns")
    await expect(page.getByTestId("autoruns-view")).toBeVisible()

    await page.getByTestId("new-autorun-primary").click()
    const panel = page.getByRole("dialog")
    await expect(panel).toBeVisible()

    const box = await panel.boundingBox()
    expect(Math.round(box?.y ?? -1)).toBeLessThanOrEqual(1)
    expect(Math.round(box?.height ?? 0)).toBe(844)
    expect(Math.round(box?.width ?? 0)).toBe(390)

    await expect(page.getByTestId("sheet-drag-handle")).toHaveCount(0)
    expect(await panel.locator("header").first().evaluate((el) => getComputedStyle(el).position)).toBe("sticky")

    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-26-compact-wizard-390x844.png") })
    await page.keyboard.press("Escape")
  })

  test("compact icons step to 20px (22px in the tab bar) and recordings collapse to one column", async ({ page }) => {
    await page.goto("/sessions")
    await expect(page.getByTestId("sessions-view")).toBeVisible()

    const tabIconHeight = await page
      .locator('[data-testid="compact-tab-bar"] svg.lucide')
      .first()
      .evaluate((el) => getComputedStyle(el).height)
    expect(tabIconHeight).toBe("22px")

    const contentIconWidth = await page.evaluate(() => {
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg")
      icon.setAttribute("class", "lucide")
      document.querySelector('[data-testid="compact-scroll"]')?.appendChild(icon)
      const value = getComputedStyle(icon).width
      icon.remove()
      return value
    })
    expect(contentIconWidth).toBe("20px")

    const gridTracks = await page.evaluate(() => {
      const probe = document.createElement("div")
      probe.setAttribute("data-testid", "recordings-grid")
      probe.style.display = "grid"
      document.body.appendChild(probe)
      const value = getComputedStyle(probe).gridTemplateColumns
      probe.remove()
      return value
    })
    expect(gridTracks.split(" ").length).toBe(1)
  })

  test("mono wells scroll horizontally instead of wrapping", async ({ page }) => {
    await page.goto("/sessions")
    await expect(page.getByTestId("sessions-view")).toBeVisible()

    const well = await page.evaluate(() => {
      const probe = document.createElement("span")
      probe.setAttribute("data-testid", "api-key-value")
      document.querySelector('[data-testid="compact-scroll"]')?.appendChild(probe)
      const styles = getComputedStyle(probe)
      const value = { whiteSpace: styles.whiteSpace, overflowX: styles.overflowX }
      probe.remove()
      return value
    })

    expect(well.whiteSpace).toBe("pre")
    expect(well.overflowX).toBe("auto")
  })

  test("the compact FAB invokes each view's primary action", async ({ page }) => {
    const paths = ["/sessions", "/autoruns", "/profiles", "/settings/users", "/settings/clients"] as const

    for (const path of paths) {
      await page.goto(path)
      await expect(page.getByTestId("compact-fab")).toBeVisible()
      await page.getByTestId("compact-fab").click()
      await expect(page.getByRole("dialog")).toHaveCount(1)
      await page.keyboard.press("Escape")
      await expect(page.getByRole("dialog")).toHaveCount(0)
    }
  })

  test("a destructive confirm keeps its typed gate and stacks Cancel above a full-width 48px confirm", async ({ page }) => {
    await page.route("**/api/auth/clients", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Cache-Control": "no-store" },
        body: JSON.stringify([{ id: 41, name: "ci-bot", created_at: "2026-09-01T00:00:00", is_active: true }]),
      })
    })

    await page.goto("/settings/clients")
    const card = page.getByTestId("compact-card").filter({ hasText: "ci-bot" })
    await card.getByTestId("compact-card-overflow").click()
    await page.getByTestId("action-sheet-revoke").click()

    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    const confirm = dialog.getByRole("button", { name: /Revoke/ })
    const cancel = dialog.getByRole("button", { name: "Cancel" })

    await expect(confirm).toBeDisabled()

    const confirmBox = await confirm.boundingBox()
    const cancelBox = await cancel.boundingBox()
    expect(Math.round(confirmBox?.height ?? 0)).toBe(48)
    expect(Math.round(cancelBox?.y ?? 0)).toBeLessThan(Math.round(confirmBox?.y ?? 0))
    expect(confirmBox?.width ?? 0).toBeGreaterThan(cancelBox?.width ?? 0)

    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-26-compact-confirm-390x844.png") })

    await page.getByLabel(/to confirm$/).fill("ci-bot")
    await expect(confirm).toBeEnabled()
  })

  test("the notification drawer opens full-screen with a 48px row and a 44px row action", async ({ page }) => {
    await page.route("**/api/notifications/**", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Cache-Control": "no-store" },
        body: JSON.stringify([
          {
            id: 5,
            user_id: 1,
            resource_type: "session",
            resource_id: 12,
            event_type: "session.failed",
            title: "Session #12 failed",
            body: null,
            read: false,
            created_at: "2026-09-20T08:00:00",
          },
        ]),
      })
    })

    await page.goto("/sessions")
    await page.getByTestId("notification-bell").click()

    const drawer = page.getByRole("dialog", { name: "Notifications" })
    await expect(drawer).toBeVisible()

    const drawerBox = await drawer.boundingBox()
    expect(Math.round(drawerBox?.x ?? -1)).toBe(0)
    expect(Math.round(drawerBox?.width ?? 0)).toBe(390)
    expect(Math.round(drawerBox?.height ?? 0)).toBe(844)

    const row = page.getByTestId("notification-row-5")
    await expect(row).toBeVisible()
    expect(Math.round((await row.boundingBox())?.height ?? 0)).toBeGreaterThanOrEqual(48)

    const removeBox = await row.getByRole("button", { name: "Delete notification" }).boundingBox()
    expect(Math.round(removeBox?.width ?? 0)).toBeGreaterThanOrEqual(44)
    expect(Math.round(removeBox?.height ?? 0)).toBeGreaterThanOrEqual(44)

    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-26-compact-drawer-390x844.png") })
  })
})
