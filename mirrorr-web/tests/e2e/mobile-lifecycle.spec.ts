/**
 * Todo 27 acceptance (spec L169 mobile lifecycle): the resume path is emulated
 * explicitly — Playwright's `page.clock` owns the 30s grace window and the test
 * dispatches `visibilitychange` itself, so the mechanism is named rather than
 * assumed. The observable contract is a refetch of the visible list on resume.
 */
import { expect, test, stubCatalogs, stubSessionList, type SessionSeed } from "./fixtures"

const ROWS: readonly SessionSeed[] = [
  {
    id: 701,
    status: "active",
    engine_id: 1,
    resolver_id: 1,
    profile_id: 9,
    recording: false,
    started_at: "2026-09-19T10:00:00",
    ended_at: null,
  },
]

async function setVisibility(page: import("@playwright/test").Page, state: "hidden" | "visible"): Promise<void> {
  await page.evaluate((next) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => next })
    document.dispatchEvent(new Event("visibilitychange"))
  }, state)
}

test.describe("mobile lifecycle at 390x844", () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test("a resume past the background grace refetches the visible list", async ({ page }) => {
    let listRequests = 0
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/sessions/") listRequests += 1
    })

    await page.clock.install()
    await stubSessionList(page, ROWS)
    await stubCatalogs(page)

    await page.goto("/sessions")
    await expect(page.getByTestId("compact-card-list")).toBeVisible()

    await setVisibility(page, "hidden")
    await page.clock.fastForward(31_000)

    const beforeResume = listRequests
    await setVisibility(page, "visible")

    await expect.poll(() => listRequests).toBeGreaterThan(beforeResume)
  })
})
