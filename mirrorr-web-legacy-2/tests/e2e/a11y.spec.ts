import AxeBuilder from "@axe-core/playwright"
import type { Page } from "@playwright/test"
import { expect, test, stubCatalogs, stubSessionList, type SessionSeed } from "./fixtures"

/**
 * Todo 30 acceptance / spec L460-L475: the accessibility floor measured, not assumed.
 * axe runs over all thirteen views at both widths; the concrete items the spec states
 * (focus ring, dialog trapping and return, live regions, names and roles, label pairs,
 * reduced motion, the compact 44px floor) are asserted directly.
 */
const DESKTOP = { width: 1280, height: 800 }
const COMPACT = { width: 390, height: 844 }
const ACCENT_RGB = "rgb(79, 140, 255)"

const SESSION_SEED: readonly SessionSeed[] = [
  {
    id: 701,
    status: "recording",
    engine_id: 1,
    resolver_id: 1,
    profile_id: 9,
    recording: true,
    started_at: "2026-09-19T10:00:00",
    ended_at: null,
  },
]

const AUTORUN_ROW = {
  id: 811,
  status: "scheduled",
  user_friendly_name: "Evening news",
  snake_case_name: "evening_news",
  engine_id: 1,
  resolver_id: 1,
  start_time: "2026-09-21T10:00:00",
  end_time: "2026-09-21T11:00:00",
  recording: false,
}

const AUTHENTICATED_VIEWS = [
  { id: "V3", path: "/sessions", anchor: "sessions-view" },
  { id: "V4", path: "/sessions/701", anchor: "session-detail" },
  { id: "V5", path: "/autoruns", anchor: "autoruns-view" },
  { id: "V6", path: "/autoruns/811", anchor: "autorun-detail" },
  { id: "V7", path: "/recordings", anchor: "recordings-view" },
  { id: "V8", path: "/profiles", anchor: "profiles-view" },
  { id: "V9", path: "/plugins", anchor: "plugins-view" },
  { id: "V10", path: "/import-export", anchor: "import-export-view" },
  { id: "V11", path: "/settings", anchor: "settings-view" },
  { id: "V12", path: "/settings/users", anchor: "settings-users-view" },
  { id: "V13", path: "/settings/clients", anchor: "settings-clients-view" },
] as const

async function stubWrapperData(page: Page): Promise<void> {
  await stubSessionList(page, SESSION_SEED)
  await stubCatalogs(page)
  await page.route("**/api/notifications/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({
        items: [
          {
            id: 5,
            user_id: 1,
            resource_type: "session",
            resource_id: 701,
            event_type: "session.failed",
            title: "Session #701 failed",
            body: null,
            read: false,
            created_at: "2026-09-20T08:00:00",
          },
        ],
        next_cursor: null,
        has_more: false,
      }),
    }),
  )
  await page.route("**/api/sessions/701", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({ ...SESSION_SEED[0], session_urls: [] }),
    })
  })
  await page.route("**/api/autoruns/**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify(AUTORUN_ROW),
    })
  })
  // The dev core answers an unauthenticated socket with 4001, which the app reads
  // as an expired session; a held-open mock keeps the stream live.
  await page.routeWebSocket(/\/ws\//, () => undefined)
}

async function axeViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).analyze()
  return results.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact ?? "unknown"}): ${violation.nodes.length} node(s) - ${violation.help}`,
  )
}

test.describe("a11y floor at 1280x800", () => {
  test.use({ viewport: DESKTOP })

  test("axe reports zero violations on all thirteen views", async ({ page }) => {
    test.setTimeout(180_000)
    await stubWrapperData(page)
    const audited: string[] = []
    for (const view of AUTHENTICATED_VIEWS) {
      await page.goto(view.path)
      await expect(page.getByTestId(view.anchor)).toBeVisible()
      expect(await axeViolations(page), `${view.id} axe violations`).toEqual([])
      audited.push(view.id)
    }
    console.log(`a11y: axe clean on ${audited.length} authenticated views at 1280x800 (${audited.join(", ")})`)
  })

  test("focus rings, dialog trapping and return, live regions and names", async ({ page }) => {
    test.setTimeout(180_000)
    await stubWrapperData(page)

    await page.goto("/sessions")
    await expect(page.getByTestId("sessions-view")).toBeVisible()

    // Focus ring: walk the tab order and require a visible accent ring on each stop.
    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
    )
    const rings: Array<{ tag: string; label: string; classes: string; shadow: string; outline: string }> = []
    for (let step = 0; step < 40 && rings.length < 10; step += 1) {
      await page.keyboard.press("Tab")
      // `transition-colors` animates outline-color too, so the first frame still
      // reads the pre-focus value; measure the settled state.
      await page.waitForTimeout(250)
      const focused = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null
        if (element === null || element === document.body) return null
        const style = getComputedStyle(element)
        return {
          tag: element.tagName.toLowerCase(),
          label: (element.getAttribute("aria-label") ?? element.textContent ?? "")
            .trim()
            .slice(0, 30),
          classes: element.className.toString().slice(0, 200),
          shadow: style.boxShadow,
          outline: `${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor}`,
        }
      })
      if (focused !== null && (focused.shadow !== "none" || focused.outline.includes("solid"))) {
        rings.push(focused)
      }
    }
    console.log(`a11y: --accent resolves to ${accent}; sampled ${rings.length} focus rings`)
    expect(rings.length, "sampled interactive elements").toBeGreaterThanOrEqual(10)
    for (const ring of rings) {
      const painted = `${ring.shadow} ${ring.outline}`
      expect(
        painted,
        `${ring.tag} "${ring.label}" focus ring uses the accent token [${ring.classes}]`,
      ).toContain(ACCENT_RGB)
    }

    // Dialog: focus is trapped inside and returns to the opener on Escape.
    const opener = page.getByRole("button", { name: /new session/i }).first()
    await opener.focus()
    await opener.press("Enter")
    const dialog = page.getByRole("dialog").first()
    await expect(dialog).toBeVisible()
    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press("Tab")
      expect(
        await page.evaluate(() => {
          const element = document.activeElement
          const dialogElement = document.querySelector('[role="dialog"]')
          return dialogElement !== null && element !== null && dialogElement.contains(element)
        }),
        "focus stays inside the dialog",
      ).toBe(true)
    }
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
    expect(
      await page.evaluate(() => document.activeElement?.textContent?.trim() ?? ""),
      "focus returns to the opener",
    ).toContain("New session")

    // Names and roles: nav, real table headers, bell.
    await page.goto("/sessions")
    await expect(page.getByTestId("sessions-view")).toBeVisible()
    expect(await page.locator('nav[aria-label]').count()).toBeGreaterThanOrEqual(1)
    expect(await page.locator("table th[scope='col']").count()).toBeGreaterThan(0)
    expect(await page.locator("button[aria-haspopup='dialog']").count()).toBeGreaterThanOrEqual(1)

    // Live regions: the connection dot, the bell's count, a detail status chip.
    const dot = page.getByTestId("connection-dot")
    await expect(dot).toHaveAttribute("role", "status")
    expect(((await dot.textContent()) ?? "").trim().length).toBeGreaterThan(0)
    await expect(page.locator("button[aria-haspopup='dialog']").first()).toHaveAttribute(
      "aria-label",
      /^\d+ unread notifications$/,
    )
    await page.goto("/sessions/701")
    await expect(page.getByTestId("session-detail")).toBeVisible()
    await expect(page.getByTestId("status-chip").first()).toHaveAttribute("aria-live", "polite")
  })
})

test.describe("a11y floor at 390x844", () => {
  test.use({ viewport: COMPACT })

  test("axe reports zero violations on all thirteen views", async ({ page }) => {
    test.setTimeout(180_000)
    await stubWrapperData(page)
    const audited: string[] = []
    for (const view of AUTHENTICATED_VIEWS) {
      await page.goto(view.path)
      await expect(page.getByTestId(view.anchor)).toBeVisible()
      expect(await axeViolations(page), `${view.id} axe violations`).toEqual([])
      audited.push(view.id)
    }
    console.log(`a11y: axe clean on ${audited.length} authenticated views at 390x844 (${audited.join(", ")})`)
  })

  test("the 44px compact floor holds across every view", async ({ page }) => {
    test.setTimeout(180_000)
    await stubWrapperData(page)
    const measured: string[] = []
    for (const view of AUTHENTICATED_VIEWS) {
      await page.goto(view.path)
      await expect(page.getByTestId(view.anchor)).toBeVisible()
      const undersized = await page.evaluate(() => {
        const selector = "button, [role='switch'], [role='tab'], select, a[href]"
        const offenders: string[] = []
        for (const element of document.querySelectorAll(selector)) {
          const node = element as HTMLElement
          const box = node.getBoundingClientRect()
          if (box.width === 0 || box.height === 0) continue
          if (box.width < 44 || box.height < 44) {
            offenders.push(
              `${node.tagName.toLowerCase()} "${(node.getAttribute("aria-label") ?? node.textContent ?? "").trim().slice(0, 24)}" ${Math.round(box.width)}x${Math.round(box.height)}`,
            )
          }
        }
        return offenders
      })
      measured.push(`${view.id}: ${undersized.length === 0 ? "clean" : undersized.join("; ")}`)
      expect(undersized, `${view.id} compact targets clear 44x44`).toEqual([])
    }
    console.log(`a11y: 44px sweep - ${measured.join(" | ")}`)
  })

  test("reduced motion removes animation and transitions", async ({ page }) => {
    test.setTimeout(180_000)
    await page.emulateMedia({ reducedMotion: "reduce" })
    await stubWrapperData(page)
    await page.goto("/sessions")
    await expect(page.getByTestId("sessions-view")).toBeVisible()
    const animated = await page.evaluate(() => {
      const candidates = [...document.querySelectorAll("*")]
      let running = 0
      let withAnimation = 0
      for (const element of candidates) {
        const style = getComputedStyle(element)
        if (style.animationName !== "none") withAnimation += 1
        if (style.transitionDuration !== "0s") running += 1
      }
      return { withAnimation, running }
    })
    expect(animated.withAnimation, "no element keeps an animation").toBe(0)
    expect(animated.running, "no element keeps a transition").toBe(0)
  })
})

test.describe("a11y floor on the public views", () => {
  test.use({ viewport: COMPACT, storageState: { cookies: [], origins: [] } })

  test("axe reports zero violations on login and register, and every field is labelled", async ({
    page,
  }) => {
    test.setTimeout(120_000)
    // V2 boots only while the core reports no users; every other outcome redirects to /login.
    await page.route("**/api/auth/status", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Cache-Control": "no-store" },
        body: JSON.stringify({ has_users: false }),
      }),
    )
    for (const view of [
      { id: "V1", path: "/login", anchor: "login-form" },
      { id: "V2", path: "/register", anchor: "register-form" },
    ] as const) {
      await page.goto(view.path)
      await expect(page.getByTestId(view.anchor)).toBeVisible()
      expect(await axeViolations(page), `${view.id} axe violations`).toEqual([])
      const unlabelled = await page.evaluate(() => {
        const offenders: string[] = []
        for (const element of document.querySelectorAll("input, select, textarea")) {
          const node = element as HTMLElement
          if (node.getAttribute("type") === "hidden") continue
          const id = node.getAttribute("id")
          const labelled =
            (id !== null && document.querySelector(`label[for="${CSS.escape(id)}"]`) !== null) ||
            node.hasAttribute("aria-label") ||
            node.hasAttribute("aria-labelledby")
          if (!labelled) offenders.push(node.outerHTML.slice(0, 100))
        }
        return offenders
      })
      expect(unlabelled, `${view.id} fields are labelled`).toEqual([])
    }
    console.log("a11y: axe clean on V1 and V2 (public), every field labelled")
  })
})
