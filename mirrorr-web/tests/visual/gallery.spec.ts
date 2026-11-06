import path from "node:path"
import type { Page } from "@playwright/test"
import { expect, test } from "../e2e/fixtures"
import { SCENARIOS, openScenario, type Scenario } from "./scenarios"

/**
 * The evidence gallery: every screen and every state the audit talks about,
 * written to `docs/ux-audit/screens/v<width>/<name>.png`.
 *
 * This is not an assertion suite — `routes.visual.spec.ts` owns pixels. The
 * point here is that the images in the audit are *reproducible*: one command
 * regenerates all of them from the same route-mocked fixtures the tests use, so
 * "before" and "after" are the same camera.
 *
 * Run: `bun run gallery`
 */

const OUT = path.resolve(import.meta.dirname, "../../../docs/ux-audit/screens")

function viewportOf(projectName: string): string {
  return projectName.replace(/^v/, "")
}

async function prepare(page: Page, scenario: Scenario): Promise<void> {
  if (scenario.prepare !== undefined) await scenario.prepare(page)
  // Entrance animations are disabled in the shot; this only stops a half-faded
  // panel from being captured while it is still mounting.
  await page.waitForTimeout(120)
}

for (const scenario of SCENARIOS) {
  test(`gallery: ${scenario.name}`, async ({ page, api }, testInfo) => {
    const viewport = viewportOf(testInfo.project.name)
    if (scenario.viewports !== undefined && !scenario.viewports.includes(viewport)) {
      test.skip()
      return
    }
    if (scenario.anonymous === true) api.data.authenticated = false
    if (scenario.data !== undefined) Object.assign(api.data, scenario.data)

    await openScenario(page, scenario)
    await prepare(page, scenario)
    await expect(page.locator("body")).toBeVisible()

    await page.screenshot({
      path: path.join(OUT, `v${viewport}`, `${scenario.name}.png`),
      fullPage: true,
      animations: "disabled",
      caret: "hide",
      scale: "css",
    })
  })
}
