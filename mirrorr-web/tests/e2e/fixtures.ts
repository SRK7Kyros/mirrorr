import { expect, test as base } from "@playwright/test"

/**
 * Shared Playwright fixture module. Specs must import `test` from here, never
 * from `@playwright/test` directly.
 *
 * The `appShell` auto-fixture is the global precondition: before every spec,
 * it navigates via the config `baseURL` (relative `goto("/")`) and asserts the
 * greenfield app marker. The legacy app serves the same `<title>Mirrorr</title>`
 * but has no `data-app="mirrorr-web"` marker, so a stale/legacy server cannot
 * satisfy this precondition.
 */
export const test = base.extend<{ appShell: void }>({
  appShell: [
    async ({ page }, use) => {
      const response = await page.goto("/")

      expect(response?.status(), "precondition: GET / must answer 200").toBe(200)
      await expect(page.locator('[data-app="mirrorr-web"]')).toHaveCount(1)

      await use()
    },
    { auto: true },
  ],
})

export { expect } from "@playwright/test"
