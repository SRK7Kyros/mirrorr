import { mkdirSync } from "node:fs"
import path from "node:path"
import { expect, test, stubCatalogs, stubSessionList, type SessionSeed } from "./fixtures"

/**
 * Status & Lifecycle Map acceptance (docs/web-frontend-spec.md L199-L211).
 * V3 renders the chips from `STATUS_MAP` only; this spec seeds one row per
 * status through the stubbed sessions list and asserts all nine chips
 * (label + dot/icon, never colour-alone) in a real browser.
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

const STATUS_ROWS: readonly SessionSeed[] = [
  ...EXPECTED_STATUSES.slice(0, 8).map(([status], index) => ({
    id: 201 + index,
    status,
    engine_id: 1,
    resolver_id: 1,
    recording: status === "recording",
  })),
  { id: 209, status: "mystery", engine_id: 1, resolver_id: 1 },
]

const SCREENSHOT_PATH = path.resolve(import.meta.dirname, "../../../.omo/evidence/task-9-statuses.png")

test("renders every status in the map and captures the all-statuses fixture", async ({ page }) => {
  await stubSessionList(page, STATUS_ROWS)
  await stubCatalogs(page)

  await page.goto("/sessions")

  const view = page.getByTestId("sessions-view")
  await expect(view).toBeVisible()
  await expect(view.getByTestId("table-row")).toHaveCount(EXPECTED_STATUSES.length)

  for (const [status, label] of EXPECTED_STATUSES) {
    const chip = view.locator(`[data-testid="status-chip"][data-status="${status}"]`)
    await expect(chip).toBeVisible()
    await expect(chip).toHaveText(label)
    // Status is never colour-only: every chip carries a dot or a state icon.
    expect(await chip.locator("span[aria-hidden='true'], svg").count()).toBeGreaterThan(0)
  }

  const unknownChip = view.locator('[data-testid="status-chip"][data-status="unknown"]')
  await expect(unknownChip).toHaveAttribute("title", "mystery")

  mkdirSync(path.dirname(SCREENSHOT_PATH), { recursive: true })
  await view.getByRole("table").screenshot({ path: SCREENSHOT_PATH })
})
