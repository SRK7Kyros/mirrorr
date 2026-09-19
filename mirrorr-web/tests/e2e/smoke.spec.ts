import { expect, test } from "./fixtures"

test("serves the mirrorr-web shell and lands the authenticated root on /sessions", async ({
  page,
}) => {
  await expect(page).toHaveTitle("Mirrorr")
  await expect(page.locator('[data-app="mirrorr-web"]')).toHaveCount(1)
  await expect(page).toHaveURL(/\/sessions$/)
  await expect(page.getByTestId("sessions-placeholder")).toBeVisible()
  await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible()
})
