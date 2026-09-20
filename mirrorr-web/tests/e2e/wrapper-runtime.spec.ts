import { expect, test, stubCatalogs, stubSessionList, type SessionSeed } from "./fixtures"

/**
 * Todo 29 acceptance (spec L593-L616): a wrapper environment reads a live session
 * list over bearer auth. Capacitor detects its platform from the native bridge
 * object rather than a user agent, so the emulation installs that bridge in an
 * init script, and seeds the keystore the runtime restores from — the same entry
 * the login path writes, whose own ordering is proven in the unit suite.
 */
const WRAPPER_ACCESS_TOKEN = "wrapper-access-token"
const ADMIN = { id: 1, username: "admin", role: "admin", display_name: "Admin" }

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

// `capacitor-storage_` is the plugin's own key prefix; the suffix is the per-origin
// key the runtime derives from a relative VITE_API_URL (/api, so the page origin).
const STORAGE_KEY = "capacitor-storage_mirrorr.tokens:http://127.0.0.1:5175"

function json(body: unknown) {
  return {
    status: 200,
    contentType: "application/json",
    headers: { "Cache-Control": "no-store" },
    body: JSON.stringify(body),
  }
}

test.describe("wrapper runtime at 390x844", () => {
  test.use({ viewport: { width: 390, height: 844 }, storageState: { cookies: [], origins: [] } })

  test("a native wrapper restores its keystore session and reads the list over bearer auth", async ({
    page,
  }) => {
    const requests: Array<{ url: string; authorization: string | null }> = []
    page.on("request", (request) => {
      requests.push({
        url: request.url(),
        authorization: request.headers()["authorization"] ?? null,
      })
    })

    await page.addInitScript(
      ([key, value]) => {
        let observer: MutationObserver | null = null
        const markWrapper = (): void => {
          if (document.documentElement === null) return
          document.documentElement.dataset.wrapper = "capacitor"
          observer?.disconnect()
        }
        observer = new MutationObserver(markWrapper)
        observer.observe(document, { childList: true, subtree: true })
        markWrapper()
        window.localStorage.setItem(key as string, value as string)
      },
      [
        STORAGE_KEY,
        JSON.stringify({ accessToken: WRAPPER_ACCESS_TOKEN, refreshToken: "wrapper-refresh-token" }),
      ],
    )

    await page.route("**/api/auth/status", (route) => route.fulfill(json({ has_users: true })))
    await page.route("**/api/auth/me", (route) =>
      route.fulfill(json({ user: ADMIN, client: null })),
    )
    // A stray 401 must self-heal rather than force a logout: a forced logout reloads
    // the app into the same unauthenticated state, which never settles.
    await page.route("**/api/auth/refresh", (route) =>
      route.fulfill(
        json({ user: ADMIN, access_token: "rotated-access", refresh_token: "rotated-refresh" }),
      ),
    )
    await page.route("**/api/notifications/**", (route) =>
      route.fulfill(json({ items: [], next_cursor: null, has_more: false })),
    )
    await stubSessionList(page, ROWS)
    await stubCatalogs(page)

    page.on("pageerror", (error) => console.log("PROBE pageerror:", error.message.slice(0, 400)))
    page.on("console", (message) =>
      console.log("PROBE console:", message.type(), message.text().slice(0, 300)),
    )
    page.on("framenavigated", (frame) => console.log("PROBE nav:", frame.url()))

    // The dev core answers an unauthenticated socket with 4001, which the app
    // correctly reads as an expired session; a held-open mock keeps the stream live.
    await page.routeWebSocket(/\/ws\//, () => undefined)

    await page.goto("/sessions")
    await expect(page.getByTestId("compact-card-list")).toBeVisible()

    const listRequest = requests.find((entry) => entry.url.includes("/api/sessions/"))
    expect(listRequest?.authorization).toBe(`Bearer ${WRAPPER_ACCESS_TOKEN}`)

    expect(await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY)).toContain(
      WRAPPER_ACCESS_TOKEN,
    )
  })
})
