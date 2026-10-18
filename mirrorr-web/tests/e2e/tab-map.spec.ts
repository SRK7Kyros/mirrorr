import { autorun, expect, session, test } from "./fixtures"
import type { Page } from "@playwright/test"

/**
 * The tab-stop map (`src/ui/components/tab-stops.ts`).
 *
 * A keyboard user's Tab order is exactly the elements marked `.tab-stop`; every
 * other control leaves the order without losing clicks or its place in the
 * accessibility tree. These tests are the map's contract: they walk real pages
 * and fail if anything reachable by Tab is unmarked, if a marked control cannot
 * be reached, or if a deliberate exclusion (`.tab-skip`) creeps back in.
 */

interface Stop {
  tag: string
  label: string
  marked: boolean
  skipped: boolean
  guard: boolean
}

async function readStop(page: Page): Promise<Stop | null> {
  return page.evaluate(() => {
    const active = document.activeElement
    if (!(active instanceof HTMLElement) || active === document.body) return null
    const aria = active.getAttribute("aria-label")
    const id = active.getAttribute("id")
    const labelled =
      aria !== null && aria.trim() !== ""
        ? aria
        : id !== null && id !== ""
          ? (document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent ?? "")
          : (active.closest("label")?.textContent ?? active.textContent ?? "")
    return {
      tag: active.tagName.toLowerCase(),
      label: labelled.trim().replace(/\s+/g, " ").slice(0, 60),
      marked: active.classList.contains("tab-stop"),
      skipped: active.closest(".tab-skip") !== null,
      guard: active.hasAttribute("data-radix-focus-guard"),
    }
  })
}

/** Presses Tab until the order wraps, and returns every stop it landed on. */
async function walk(page: Page, limit = 80): Promise<Stop[]> {
  const stops: Stop[] = []
  const start = await readStop(page)
  if (start !== null && !start.guard) stops.push(start)
  for (let index = 0; index < limit; index += 1) {
    await page.keyboard.press("Tab")
    const stop = await readStop(page)
    if (stop === null) break
    // Radix's focus guards are the machinery behind its modal trap, not stops.
    if (stop.guard) continue
    if (stops.length > 0 && stop.tag === stops[0].tag && stop.label === stops[0].label) break
    stops.push(stop)
  }
  return stops
}

/** Sequentially focusable elements that are neither marked nor claiming their own stop. */
async function strayStops(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = []
    for (const element of document.querySelectorAll<HTMLElement>(
      "[tabindex], a[href], button, input, select, textarea, summary",
    )) {
      if (element.closest(".tab-skip") !== null) continue
      if (element.hasAttribute("data-radix-focus-guard")) continue
      if (element.tabIndex < 0) continue
      if (element.classList.contains("tab-stop") || element.hasAttribute("tabindex")) continue
      const label = (element.getAttribute("aria-label") ?? element.textContent ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 40)
      out.push(`${element.tagName.toLowerCase()} :: ${label}`)
    }
    return out
  })
}

function labels(stops: readonly Stop[]): string[] {
  return stops.map((stop) => stop.label)
}

async function expectOnlyMarkedStops(page: Page): Promise<Stop[]> {
  const stops = await walk(page)
  expect(stops.length, "the walk never landed on a stop").toBeGreaterThan(0)
  for (const stop of stops) {
    expect(stop.skipped, `${stop.tag} "${stop.label}" is inside a tab-skip region`).toBe(false)
    expect(stop.marked, `${stop.tag} "${stop.label}" is reachable but not a marked tab stop`).toBe(
      true,
    )
  }
  return stops
}

test.describe("tab-stop map", () => {
  test("leaves nothing focusable outside the map on the list pages", async ({ page, api }) => {
    api.data.sessions = [session({ id: 7 }), session({ id: 8 })]
    api.data.autoruns = [autorun({ id: 5, user_friendly_name: "F1 Race" })]
    api.data.users = [
      { id: 1, username: "kyros", role: "admin", display_name: "Kyros" },
      { id: 2, username: "alice", role: "user", display_name: "Alice" },
    ]

    // The invariant, over the whole document rather than just what a walk visits:
    // a sequentially focusable element is marked, or it declares its own stop
    // (the roving widgets: `Segmented`, the access catalog).
    for (const route of [
      "/sessions",
      "/sessions/7",
      "/autoruns",
      "/recordings",
      "/profiles",
      "/presets",
      "/plugins",
      "/import-export",
      "/settings",
    ]) {
      await page.goto(route)
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
      expect(await strayStops(page), `unmarked stops on ${route}`).toEqual([])
    }
  })

  test("reaches the controls a keyboard user needs on the sessions list", async ({ page, api }) => {
    api.data.sessions = [session({ id: 7 }), session({ id: 8 })]

    await page.goto("/sessions")
    await expect(page.getByRole("heading", { level: 1, name: "Sessions" })).toBeVisible()

    const stops = labels(await expectOnlyMarkedStops(page))
    for (const wanted of ["Filter sessions", "Refresh"]) {
      expect(stops, `"${wanted}" is not reachable by Tab: ${stops.join(" | ")}`).toContain(wanted)
    }
    expect(
      stops.some((label) => label === "Sessions" || label === "Autoruns"),
      `the rail is not reachable by Tab: ${stops.join(" | ")}`,
    ).toBe(true)
  })

  test("keeps the access dialog's controls reachable and its close button out", async ({
    page,
    api,
  }) => {
    api.data.users = [
      { id: 1, username: "kyros", role: "admin", display_name: "Kyros" },
      { id: 2, username: "alice", role: "user", display_name: "Alice" },
      { id: 3, username: "bob", role: "user", display_name: "Bob" },
      { id: 4, username: "carol", role: "user", display_name: "Carol" },
    ]
    api.data.autoruns = [autorun({ id: 5, user_friendly_name: "F1 Race" })]
    api.data.resources = [
      {
        resource_type: "autorun",
        id: 5,
        label: "F1 Race",
        owner: "kyros",
        owner_missing: false,
        viewer_count: 0,
        system: false,
      },
    ]

    api.data.ownerUsers = { "autorun:5": ["bob", "carol"] }
    await page.goto("/admin.html")
    await page.getByRole("link", { name: "Back to sessions" }).click()
    await page.getByRole("link", { name: "Autoruns", exact: true }).first().click()
    await page.getByRole("button", { name: "Access for F1 Race" }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()

    // Every co-owner badge is a stop of its own — Shift+Tab out of the owner
    // field walks the badges — and the whole badge, not just its ×, is the
    // control: Backspace drops that principal, Enter hands them the crown.
    const ownerField = dialog.getByRole("combobox", { name: "Add an owner" })
    await ownerField.click()
    await page.keyboard.press("Shift+Tab")
    await expect(dialog.getByRole("button", { name: "Make Carol the owner" })).toBeFocused()
    await page.keyboard.press("Backspace")
    await expect(dialog.getByRole("button", { name: "Make Carol the owner" })).toHaveCount(0)
    await expect(ownerField).toBeFocused()
    await page.keyboard.press("Shift+Tab")
    await expect(dialog.getByRole("button", { name: "Make Bob the owner" })).toBeFocused()
    await page.keyboard.press("Enter")
    await expect(dialog.getByTestId("owner-crown")).toContainText("Bob")
    await expect(ownerField).toBeFocused()

    // Escape closes the dialog, so its × is deliberately out of the order.
    await expect(dialog.getByRole("button", { name: "Close" })).toHaveAttribute("tabindex", "-1")

    // The owner suggestion list used to unmount on blur, and Radix's focus scope
    // yanked focus back to the dialog container when it did — everything after
    // the owner field was unreachable. The order must run straight through now.
    await dialog.getByRole("combobox", { name: "Add an owner" }).click()
    await page.keyboard.press("Tab")
    await expect(dialog.getByRole("combobox", { name: "Search users and groups" })).toBeFocused()
    await page.keyboard.press("Tab")
    await expect(dialog.getByRole("button", { name: "Select all" })).toBeFocused()
    await page.keyboard.press("Tab")
    // The catalog is one roving stop, and the card that holds it is whichever
    // one is highlighted — not necessarily the first principal in the pool.
    await expect(
      dialog.getByTestId("access-catalog").locator('[role="option"][data-highlighted="true"]'),
    ).toBeFocused()

    // Picking a card selects it; granting a capability through a chip is what
    // makes the draft dirty, and that is when Apply joins the order.
    await page.keyboard.press("Enter")
    await dialog.getByRole("button", { name: "View access" }).focus()
    await page.keyboard.press("Enter")
    const apply = dialog.getByRole("button", { name: "Apply changes" })
    await expect(apply).toBeEnabled()
    for (let index = 0; index < 8 && !(await apply.evaluate((el) => el === document.activeElement)); index += 1) {
      await page.keyboard.press("Tab")
    }
    await expect(apply).toBeFocused()

    // ArrowDown/ArrowUp walk that same order, so a keyboard user moves between
    // controls without Tab; a text field keeps its own arrows, and the walk
    // stops at the dialog's edges instead of escaping to the page behind it.
    const search = dialog.getByRole("combobox", { name: "Search users and groups" })
    await search.focus()
    await page.keyboard.press("ArrowDown")
    await expect(search).toBeFocused()

    await page.keyboard.press("Tab")
    await expect(dialog.getByRole("button", { name: "Select all" })).toBeFocused()
    await page.keyboard.press("ArrowDown")
    await expect(dialog.getByRole("button", { name: "Clear" })).toBeFocused()
    await page.keyboard.press("ArrowUp")
    await expect(dialog.getByRole("button", { name: "Select all" })).toBeFocused()

    await apply.focus()
    await page.keyboard.press("ArrowDown")
    await expect(apply).toBeFocused()
  })

  test("marks the login form's own controls", async ({ page, api }) => {
    api.data.authenticated = false

    await page.goto("/sessions")

    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible()
    await page.getByLabel("Username").fill("kyros")
    await page.getByLabel("Password").fill("hunter2")
    await page.getByLabel("Username").focus()
    await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled()

    const stops = labels(await expectOnlyMarkedStops(page))
    const summary = `the login form's stops: ${stops.join(" | ")}`
    expect(stops.some((label) => label.startsWith("Username")), summary).toBe(true)
    expect(stops.some((label) => label.startsWith("Password")), summary).toBe(true)
    expect(stops, summary).toContain("Sign in")
  })
})
