import type { Page } from "@playwright/test"
import { engine, expect, resolver, test } from "./fixtures"

/**
 * The plugins view renders two panels (Engines, Resolvers), each with its own
 * table/card pair — so every assertion is scoped to one `section.panel` rather
 * than to a bare `.table-desktop`, which would match twice.
 */
function panel(page: Page, title: string) {
  return page
    .locator("section.panel")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
}

test.describe("plugins", () => {
  test.beforeEach(async ({ api }) => {
    api.data.engines = [
      engine({ id: 1, name: "Streamlink", description: "HLS engine" }),
      engine({
        id: 2,
        name: "yt-dlp",
        description: "Fallback grabber",
        origin: "user",
        origin_hash: "def5678",
        capabilities: { can_stream: true, can_record: true },
      }),
    ]
    api.data.resolvers = [resolver({ id: 1, name: "Wide IPTV" })]
  })

  test("badges each engine's capabilities in the table", async ({ page }) => {
    await page.goto("/plugins")

    await expect(page.getByRole("heading", { level: 1, name: "Plugins" })).toBeVisible()

    const engines = panel(page, "Engines")
    const table = engines.locator(".table-desktop")
    await expect(table).toBeVisible()
    await expect(table.locator("tbody tr")).toHaveCount(2)
    // Streamlink cannot record; yt-dlp can — the badge variant is the assertion.
    await expect(table.getByTitle("Record: not supported")).toHaveCount(1)
    await expect(table.getByTitle("Record: supported")).toHaveCount(1)
    await expect(table.getByTitle("Stream: supported")).toHaveCount(2)
  })

  test("swaps the engines table for cards at a phone width", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 720 })

    await page.goto("/plugins")

    const engines = panel(page, "Engines")
    await expect(engines.locator(".table-desktop")).toBeHidden()
    await expect(engines.locator(".cards-mobile")).toBeVisible()
    await expect(engines.locator(".cards-mobile .entity-card")).toHaveCount(2)
    await expect(engines.locator(".cards-mobile .capability-row")).toHaveCount(2)
  })

  test("shows a resolver's config schema instead of capability badges", async ({ page }) => {
    await page.goto("/plugins")

    const resolvers = panel(page, "Resolvers")
    await expect(resolvers).toContainText("Wide IPTV")
    await expect(resolvers.locator(".capability-stack")).toHaveCount(0)
  })
})
