import { mkdirSync } from "node:fs"
import path from "node:path"
import { expect, test } from "./fixtures"

/**
 * Status & Lifecycle Map acceptance (docs/web-frontend-spec.md L199-L211).
 * The Sessions placeholder renders every STATUS_MAP entry; this spec asserts
 * all nine chips (label + dot/icon, never colour-alone) in a real browser and
 * captures the fixture screenshot for the evidence file.
 */

const EXPECTED_STATUSES = [
  ["scheduled", "Scheduled"],
  ["active", "Running"],
  ["recording", "Recording"],
  ["terminating", "Stopping…"],
  ["remuxing", "Remuxing"],
  ["finalizing", "Finalizing"],
  ["completed", "Completed"],
  ["failed", "Failed"],
  ["unknown", "Unknown"],
] as const

const SCREENSHOT_PATH = path.resolve(import.meta.dirname, "../../../.omo/evidence/task-9-statuses.png")

test("renders every status in the map and captures the all-statuses fixture", async ({ page }) => {
  await page.goto("/sessions")

  const fixture = page.getByTestId("status-fixture")
  await expect(fixture).toBeVisible()

  for (const [status, label] of EXPECTED_STATUSES) {
    const chip = fixture.locator(`[data-testid="status-chip"][data-status="${status}"]`)
    await expect(chip).toBeVisible()
    await expect(chip).toHaveText(label)
    // Status is never colour-only: every chip carries a dot or a state icon.
    expect(await chip.locator("span[aria-hidden='true'], svg").count()).toBeGreaterThan(0)
  }

  await expect(fixture.locator('[data-testid="status-chip"]')).toHaveCount(EXPECTED_STATUSES.length)

  mkdirSync(path.dirname(SCREENSHOT_PATH), { recursive: true })
  await fixture.screenshot({ path: SCREENSHOT_PATH })
})
