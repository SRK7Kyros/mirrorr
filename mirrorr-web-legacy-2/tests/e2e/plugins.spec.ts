/**
 * Task 15 e2e — V9 `/plugins` (spec L303-L337 + L395).
 *
 * Real path: the dev core ships exactly one engine (`yt_dlp_piped`) and one
 * resolver (`static`) with origin hashes, capability flags and JSON schemas —
 * everything the read-only cards must show. Stubbed path: a degraded engine
 * without record/playlist capability to pin the neutral badges.
 *
 * There is no edit affordance anywhere: only hash copying is interactive.
 */
import path from "node:path"
import { expect, test } from "./fixtures"

const EVIDENCE_DIR = path.resolve(import.meta.dirname, "../../../.omo/evidence")

test.use({ permissions: ["clipboard-read", "clipboard-write"] })

test("real: engine and resolver cards are read-only with badges, hashes and schemas", async ({ page }) => {
  await page.goto("/plugins")
  const view = page.getByTestId("plugins-view")
  await expect(view).toBeVisible()

  await expect(page.getByRole("heading", { name: "Engines" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Resolvers" })).toBeVisible()

  const engineCard = page.getByTestId("engine-card-1")
  await expect(engineCard).toBeVisible()
  await expect(engineCard.getByRole("heading", { name: "yt_dlp_piped" })).toBeVisible()
  await expect(engineCard.getByText("Record", { exact: true })).toBeVisible()
  await expect(engineCard.getByText("Playlist", { exact: true })).toBeVisible()

  const hashText = await engineCard.locator("span[title]").first().getAttribute("title")
  expect(hashText).not.toBeNull()
  await engineCard.getByRole("button", { name: "Copy origin hash for yt_dlp_piped" }).click()
  await expect(page.getByText("Origin hash copied")).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(hashText)

  await engineCard.getByText("Retry modes").click()
  await expect(engineCard.locator("details[open]")).toBeVisible()
  await expect(engineCard.getByText("count", { exact: true })).toBeVisible()

  const resolverCard = page.getByTestId("resolver-card-1")
  await expect(resolverCard.getByRole("heading", { name: "static" })).toBeVisible()
  await resolverCard.getByText("Config schema").click()
  const schema = resolverCard.getByTestId("resolver-config-schema")
  await expect(schema).toBeVisible()
  await expect(schema).toContainText('"url"')

  await expect(page.getByText("Plugins are discovered at server boot")).toBeVisible()
  await expect(view.getByRole("button", { name: /edit|save|delete|remove|new/i })).toHaveCount(0)
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-15-plugins-real.png") })
})

const FALLBACK_ENGINE = {
  id: 2,
  name: "noop_engine",
  description: "Records nothing.",
  origin: "noop",
  origin_hash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  capabilities: { can_record: false, can_playlist: false },
}

test("stub: an engine without capabilities shows the neutral badges", async ({ page }) => {
  await page.route("**/api/engines/**", (route) =>
    route.fulfill({ json: { items: [FALLBACK_ENGINE], next_cursor: null, has_more: false } }),
  )
  await page.route("**/api/resolvers/**", (route) =>
    route.fulfill({ json: { items: [], next_cursor: null, has_more: false } }),
  )

  await page.goto("/plugins")
  const card = page.getByTestId("engine-card-2")
  await expect(card).toBeVisible()
  await expect(card.getByText("no record", { exact: true })).toBeVisible()
  await expect(card.getByText("no playlist", { exact: true })).toBeVisible()
  await expect(card.getByText("Retry modes")).toHaveCount(0)
  await expect(card.getByText(/0123456789ab/)).toBeVisible()
})
