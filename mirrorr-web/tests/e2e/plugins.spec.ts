import type { Page } from "@playwright/test"
import { engine, expect, resolver, test } from "./fixtures"

/**
 * The plugins view is one table over both kinds — engines and resolvers share
 * a column grid, and `Kind` is what tells them apart. Assertions therefore
 * scope to the one table rather than to a section per kind.
 */

function table(page: Page) {
  return page.getByRole("table")
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

  test("lists engines and resolvers in one table, told apart by Kind", async ({ page }) => {
    await page.goto("/plugins")

    await expect(page.getByRole("heading", { level: 1, name: "Plugins" })).toBeVisible()

    const rows = table(page).locator("tbody tr")
    await expect(rows).toHaveCount(3)
    await expect(table(page).getByRole("columnheader", { name: "Kind" })).toBeVisible()

    const streamlink = rows.filter({ hasText: "Streamlink" })
    await expect(streamlink).toContainText("Engine")
    const wide = rows.filter({ hasText: "Wide IPTV" })
    await expect(wide).toContainText("Resolver")
  })

  test("badges each engine's capabilities and leaves resolver capabilities empty", async ({ page }) => {
    await page.goto("/plugins")

    const all = table(page)
    // Streamlink cannot record; yt-dlp can — the badge variant is the assertion.
    await expect(all.getByTitle("Record: not supported")).toHaveCount(1)
    await expect(all.getByTitle("Record: supported")).toHaveCount(1)
    await expect(all.getByTitle("Stream: supported")).toHaveCount(2)

    const wide = all.locator("tbody tr").filter({ hasText: "Wide IPTV" })
    await expect(wide.getByTitle("Record: supported")).toHaveCount(0)
    await expect(wide.getByTitle("Stream: supported")).toHaveCount(0)
  })

  test("keeps a resolver's config schema behind a disclosure", async ({ page }) => {
    await page.goto("/plugins")

    const wide = table(page).locator("tbody tr").filter({ hasText: "Wide IPTV" })
    const toggle = wide.getByRole("button", { name: "Show config for Wide IPTV" })
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    await expect(table(page).getByText("config schema")).toHaveCount(0)

    await toggle.click()

    await expect(wide.getByRole("button", { name: "Hide config for Wide IPTV" })).toHaveAttribute(
      "aria-expanded",
      "true",
    )
  })

  test("swaps the table for cards at a phone width", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 720 })

    await page.goto("/plugins")

    await expect(page.getByRole("table")).toBeHidden()
    // A cold Vite transform can outlast the default 5 s budget with two workers sharing one server.
    await expect(page.getByRole("main").locator("article")).toHaveCount(3, { timeout: 15_000 })
  })
})
