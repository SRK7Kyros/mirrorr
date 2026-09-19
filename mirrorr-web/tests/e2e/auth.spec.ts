import { expect, test } from "./fixtures"

/**
 * Auth flows end to end.
 *
 * Login budget: the dev API allows 10 login POSTs per 60s per IP. This file
 * spends 4 real POSTs (sign-in, wrong password, deep link, //evil); the setup
 * project spends 1. The 429 lockout is asserted against a stubbed response —
 * never by exhausting the real limiter. The isolated exhaustive run lives in
 * `tests/ratelimit/` behind `bun run test:ratelimit`.
 */
test.describe("authenticated storage state", () => {
  test("the stored session lands on /sessions", async ({ page }) => {
    await page.goto("/")
    await expect(page).toHaveURL(/\/sessions$/)
    await expect(page.getByTestId("sessions-view")).toBeVisible()
  })

  test("an unknown path renders the 404 view with a home link", async ({ page }) => {
    await page.goto("/no-such-route")
    await expect(page.getByTestId("not-found")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Go home" })).toHaveAttribute("href", "/")
  })
})

test.describe("login, register and guard redirects (logged out)", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("signs in with the seeded admin and reaches /sessions", async ({ page }) => {
    await page.goto("/login")
    await page.getByLabel("Username").fill("admin")
    await page.getByLabel("Password", { exact: true }).fill("admin123")
    await page.getByRole("button", { name: "Sign in" }).click()

    await expect(page).toHaveURL(/\/sessions$/)
    await expect(page.getByTestId("sessions-view")).toBeVisible()
  })

  test("a wrong password shows the exact inline copy and no toast", async ({ page }) => {
    const refreshRequests: string[] = []
    page.on("request", (request) => {
      if (request.url().includes("/auth/refresh")) refreshRequests.push(request.url())
    })

    await page.goto("/login")
    await page.getByLabel("Username").fill("admin")
    await page.getByLabel("Password", { exact: true }).fill("definitely-wrong")
    await page.getByRole("button", { name: "Sign in" }).click()

    await expect(page.getByTestId("login-error")).toHaveText("Invalid username or password")
    await expect(page.getByTestId("toast")).toHaveCount(0)
    expect(refreshRequests).toEqual([])
  })

  test("a logged-out deep link round-trips ?redirect to the original path", async ({ page }) => {
    await page.goto("/autoruns")
    await expect(page).toHaveURL(/\/login\?redirect=(%2F|\/)autoruns$/)

    await page.getByLabel("Username").fill("admin")
    await page.getByLabel("Password", { exact: true }).fill("admin123")
    await page.getByRole("button", { name: "Sign in" }).click()

    await expect(page).toHaveURL(/\/autoruns$/)
    await expect(page.getByTestId("autoruns-placeholder")).toBeVisible()
  })

  test("//evil is rejected and login lands on /sessions", async ({ page }) => {
    await page.goto("/login?redirect=//evil.example.com")
    await page.getByLabel("Username").fill("admin")
    await page.getByLabel("Password", { exact: true }).fill("admin123")
    await page.getByRole("button", { name: "Sign in" }).click()

    await expect(page).toHaveURL(/\/sessions$/)
  })

  test("/register bounces to /login when users exist and the footer hint is absent", async ({ page }) => {
    await page.goto("/register")

    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByTestId("login-form")).toBeVisible()
    await expect(page.getByRole("link", { name: "Create the first admin account" })).toHaveCount(0)
  })

  test("a stubbed 429 login shows the lockout toast and disables submit for 30s", async ({ page }) => {
    await page.clock.install()
    await page.route("**/api/auth/login", (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Rate limited" }),
      }),
    )

    await page.goto("/login")
    await page.getByLabel("Username").fill("admin")
    await page.getByLabel("Password", { exact: true }).fill("admin123")
    await page.getByRole("button", { name: "Sign in" }).click()

    await expect(page.getByTestId("toast")).toHaveText("Too many attempts — try again shortly")
    const submit = page.getByRole("button", { name: "Sign in" })
    await expect(submit).toBeDisabled()

    await page.clock.fastForward(30_000)
    await expect(submit).toBeEnabled()
  })

  test("a stubbed 429 register shows the same toast", async ({ page }) => {
    await page.route("**/api/auth/status", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ has_users: false }),
      }),
    )
    await page.route("**/api/auth/register", (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Rate limited" }),
      }),
    )

    await page.goto("/register")
    await page.getByLabel("Username").fill("admin")
    await page.getByLabel("Password", { exact: true }).fill("long-enough-password")
    await page.getByLabel("Confirm password").fill("long-enough-password")
    await page.getByRole("button", { name: "Create admin account" }).click()

    await expect(page.getByTestId("toast")).toHaveText("Too many attempts — try again shortly")
  })

  test("a stubbed network failure shows 'API unreachable' inline", async ({ page }) => {
    await page.route("**/api/auth/login", (route) => route.abort("failed"))

    await page.goto("/login")
    await page.getByLabel("Username").fill("admin")
    await page.getByLabel("Password", { exact: true }).fill("admin123")
    await page.getByRole("button", { name: "Sign in" }).click()

    await expect(page.getByTestId("login-error")).toHaveText("API unreachable")
    await expect(page.getByTestId("toast")).toHaveCount(0)
  })

  test("a stubbed has_users:false renders the V2 bootstrap copy", async ({ page }) => {
    await page.route("**/api/auth/status", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ has_users: false }),
      }),
    )

    await page.goto("/register")

    await expect(
      page.getByRole("heading", { name: "Create the first admin account" }),
    ).toBeVisible()
    await expect(page.getByText("This first account becomes the administrator")).toBeVisible()
  })
})
