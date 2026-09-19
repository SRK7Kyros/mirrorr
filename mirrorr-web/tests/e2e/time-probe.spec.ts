import { mkdirSync } from "node:fs"
import path from "node:path"
import { expect, test } from "./fixtures"

/**
 * Time-module display acceptance (docs/web-frontend-spec.md L223-L234). Runs in
 * a real browser with a pinned zone and locale so the local display is
 * deterministic even though the host machine's zone is UTC.
 */
test.use({ timezoneId: "America/New_York", locale: "en-US" })

const SCREENSHOT_PATH = path.resolve(import.meta.dirname, "../../../.omo/evidence/task-11-time-probe.png")

test("renders the zone label once, a titled relative time and the duration boundary", async ({ page }) => {
  await page.goto("/dev/data-probe")

  const probe = page.getByTestId("time-probe")
  await expect(probe).toBeVisible()

  // The local tz abbreviation is rendered once per view (spec L228).
  await expect(page.getByTestId("tz-label")).toHaveCount(1)
  await expect(page.getByTestId("tz-label")).toHaveText("EDT")

  // The absolute display is the pinned zone's wall time, not UTC.
  await expect(page.getByTestId("absolute-time")).toHaveText("Jul 15, 2026, 8:00 AM")

  // Lists show relative time with the absolute local string in `title` (L228).
  await expect(page.getByTestId("relative-time")).toHaveText("2 min ago")
  await expect(page.getByTestId("relative-time")).toHaveAttribute("title", "Jul 15, 2026, 7:58 AM")

  // Countdown text is coarse; durations cross the m:ss / h:mm:ss boundary (L231-L232).
  await expect(page.getByTestId("countdown")).toHaveText("starts in ~3 h 12 min")
  await expect(page.getByTestId("duration-short")).toHaveText("59:59")
  await expect(page.getByTestId("duration-long")).toHaveText("1:00:00")

  mkdirSync(path.dirname(SCREENSHOT_PATH), { recursive: true })
  await probe.screenshot({ path: SCREENSHOT_PATH })
})
