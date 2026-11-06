import { expect, test } from "../e2e/fixtures"
import { SCENARIOS, openScenario } from "./scenarios"

/**
 * One screenshot per (route x state), rendered against the route-mocked API in
 * `tests/e2e/fixtures.ts`. The scenario list is shared with the evidence
 * gallery (`gallery.spec.ts`) and the accessibility sweep (`a11y.spec.ts`), so
 * a state added for the audit is also a state that fails loudly when it changes.
 *
 * States are chosen to exercise the surfaces where fidelity lives: populated
 * cards/tables, empty and filtered-empty lists, a forced failure, an
 * authenticated detail view, the anonymous auth screens, and the administration
 * section of the second build.
 */

for (const scenario of SCENARIOS) {
  if (scenario.skipBaseline === true) continue
  test(`visual: ${scenario.name}`, async ({ page, api }, testInfo) => {
    // A scenario may be meaningful on a subset of widths (e.g. a phone-only
    // overflow probe); the project name carries the width.
    const viewport = testInfo.project.name.replace(/^v/, "")
    if (scenario.viewports !== undefined && !scenario.viewports.includes(viewport)) {
      test.skip()
      return
    }
    if (scenario.anonymous === true) api.data.authenticated = false
    if (scenario.data !== undefined) Object.assign(api.data, scenario.data)
    await openScenario(page, scenario)
    if (scenario.prepare !== undefined) {
      await scenario.prepare(page)
      await page.waitForTimeout(120)
    }
    await expect(page).toHaveScreenshot(`${scenario.name}.png`, { fullPage: true })
  })
}
