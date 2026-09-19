import { expect, test } from "@playwright/test"

/**
 * Deliberate exhaustion of the real login limiter (10/min per IP).
 *
 * NEVER part of the default suite. Run with `bun run test:ratelimit`
 * (`workers: 1`, no stored auth). Best used when the operator is not logging
 * in interactively, because the budget is shared per IP.
 */
const MAX_ATTEMPTS = 12

test("the real login limiter answers 429 and locks the submit out", async ({ page }) => {
  await page.goto("/login")
  await page.getByLabel("Username").fill("admin")
  await page.getByLabel("Password", { exact: true }).fill("definitely-wrong")

  const submit = page.getByRole("button", { name: "Sign in" })
  let sawRateLimit = false

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    await submit.click()
    const toast = page.getByTestId("toast")
    const rateLimited = await toast
      .waitFor({ state: "visible", timeout: 3000 })
      .then(() => true)
      .catch(() => false)

    if (rateLimited) {
      sawRateLimit = true
      break
    }

    await expect(page.getByTestId("login-error")).toHaveText("Invalid username or password")
  }

  expect(sawRateLimit, "the limiter must answer 429 within the attempt budget").toBe(true)
  await expect(page.getByTestId("toast")).toHaveText("Too many attempts — try again shortly")
  await expect(submit).toBeDisabled()
})
