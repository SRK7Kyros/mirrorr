import { expect, test } from "./fixtures"

test("serves the mirrorr-web shell and mounts the index route", async ({ page }) => {
  await expect(page).toHaveTitle("Mirrorr")
  await expect(page.locator('[data-app="mirrorr-web"]')).toHaveCount(1)
  await expect(page.getByRole("heading", { name: "Mirrorr" })).toBeVisible()
  await expect(page.getByText("Client scaffold online.")).toBeVisible()
})
