import { expect, test } from "@playwright/test"

// Scaffold smoke: the two-branch router serves the neutral placeholder on the
// authenticated landing (the guard stub resolves without a backend).
test("scaffold shell renders the placeholder", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Mirrorr" })).toBeVisible()
})
