import path from "node:path"
import type { Page, WebSocketRoute } from "@playwright/test"
import { expect, test, stubCatalogs, stubSessionList, type SessionSeed } from "./fixtures"

/**
 * Todo 20 acceptance (spec L189/L193/L195, contract §11.2/§13.4): a pushed
 * notification frame reaches the badge and the drawer's REST flush with tuple
 * dedupe; a duplicated tuple and a reconnect re-flush change nothing; a remux
 * progress frame updates only the open session's card.
 *
 * Failure injection is client-side only (`page.routeWebSocket` + `page.route`):
 * the routed sockets are mocked and never proxied, so the real server's unread
 * flush and live event traffic cannot leak into the assertions.
 */

const EVIDENCE_DIR = path.resolve(import.meta.dirname, "../../../.omo/evidence")

const PUSHED_TUPLE = {
  resource_type: "session",
  resource_id: 913,
  event_type: "session.stopped",
  title: "session 913: session.stopped",
  created_at: "2026-09-20T10:00:00",
}

const REST_ROW = { id: 7001, user_id: 1, ...PUSHED_TUPLE, body: "", read: false }

const DETAIL_SESSION: SessionSeed = {
  id: 913,
  status: "remuxing",
  engine_id: 1,
  resolver_id: 1,
  session_urls: [],
  attempts: [],
}

function json(body: unknown): { status: number; contentType: string; body: string } {
  return { status: 200, contentType: "application/json", body: JSON.stringify(body) }
}

function countLoginPosts(page: Page): string[] {
  const logins: string[] = []
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/auth/login") {
      logins.push(request.url())
    }
  })
  return logins
}

async function captureSockets(page: Page, role: "events" | "notifications"): Promise<WebSocketRoute[]> {
  const routes: WebSocketRoute[] = []
  await page.routeWebSocket("**/ws/**", (ws) => {
    if (ws.url().endsWith(`/ws/${role}`)) routes.push(ws)
  })
  return routes
}

function pushNotificationFrame(route: WebSocketRoute | undefined, data: Record<string, unknown>): void {
  if (route === undefined) throw new Error("no routed notifications socket")
  route.send(JSON.stringify({ type: "notification", data }))
}

function pushRemuxProgress(
  route: WebSocketRoute | undefined,
  sessionId: number,
  fields: Record<string, unknown>,
): void {
  if (route === undefined) throw new Error("no routed events socket")
  route.send(JSON.stringify({ event: `session.${sessionId}.remux.progress`, ...fields }))
}

test("a pushed notification reaches the badge and the drawer; a duplicate tuple and a reconnect re-flush stay at one row", async ({
  page,
}) => {
  const logins = countLoginPosts(page)
  let rows: readonly Record<string, unknown>[] = []
  await page.route("**/api/notifications/**", async (route) => {
    const request = route.request()
    if (request.method() === "GET" && new URL(request.url()).pathname === "/api/notifications/") {
      await route.fulfill({ ...json(rows), headers: { "Cache-Control": "no-store" } })
      return
    }
    await route.fallback()
  })
  const notificationSockets = await captureSockets(page, "notifications")

  await page.goto("/sessions")
  const bell = page.getByTestId("notification-bell")
  await expect(bell).toHaveAttribute("aria-label", "0 unread notifications")
  await expect.poll(() => notificationSockets.length).toBeGreaterThan(0)
  await expect(page.getByTestId("connection-dot")).toHaveAttribute("data-status", "live")

  rows = [REST_ROW]
  pushNotificationFrame(notificationSockets.at(-1), PUSHED_TUPLE)
  await expect(bell).toHaveAttribute("aria-label", "1 unread notifications")

  await bell.click()
  const drawer = page.getByRole("dialog", { name: "Notifications" })
  await expect(drawer.getByTestId("notification-row-7001")).toBeVisible()

  pushNotificationFrame(notificationSockets.at(-1), PUSHED_TUPLE)
  await expect(bell).toHaveAttribute("aria-label", "1 unread notifications")
  await expect(drawer.locator('[data-testid^="notification-row-"]')).toHaveCount(1)

  const before = notificationSockets.length
  notificationSockets.at(-1)?.close()
  await expect.poll(() => notificationSockets.length).toBeGreaterThan(before)
  await expect(page.getByTestId("connection-dot")).toHaveAttribute("data-status", "live")
  pushNotificationFrame(notificationSockets.at(-1), PUSHED_TUPLE)
  await expect(bell).toHaveAttribute("aria-label", "1 unread notifications")
  await expect(drawer.locator('[data-testid^="notification-row-"]')).toHaveCount(1)

  await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-20-notification-badge-drawer.png") })
  expect(logins, "the shared storageState must carry auth; no UI login").toHaveLength(0)
})

test("remux progress updates the open session's card and is dropped for another session", async ({ page }) => {
  const logins = countLoginPosts(page)
  await stubCatalogs(page)
  await stubSessionList(page, [DETAIL_SESSION])
  await page.route("**/api/sessions/913", async (route) => {
    if (new URL(route.request().url()).pathname !== "/api/sessions/913") {
      await route.fallback()
      return
    }
    await route.fulfill({ ...json(DETAIL_SESSION), headers: { "Cache-Control": "no-store" } })
  })
  const eventSockets = await captureSockets(page, "events")

  await page.goto("/sessions/913")
  await expect(page.getByTestId("session-detail")).toBeVisible()
  await expect.poll(() => eventSockets.length).toBeGreaterThan(0)
  await expect(page.getByTestId("connection-dot")).toHaveAttribute("data-status", "live")

  const card = page.getByTestId("remux-progress-card")
  await expect(card).toBeVisible()
  await expect(card).toHaveAttribute("data-mode", "indeterminate")

  pushRemuxProgress(eventSockets.at(-1), 914, { percent: 99, eta_seconds: 5, speed: "2x" })
  await expect(card).toHaveAttribute("data-mode", "indeterminate")
  await expect(card.getByTestId("remux-progress-label")).not.toContainText("99%")

  pushRemuxProgress(eventSockets.at(-1), 913, { percent: 42.4, eta_seconds: 30, speed: "1.5x" })
  await expect(card).toHaveAttribute("data-mode", "determinate")
  await expect(card.getByTestId("remux-progress-track")).toHaveAttribute("aria-valuenow", "42")
  await expect(card.getByTestId("remux-progress-label")).toContainText("42%")
  await expect(card.getByTestId("remux-progress-label")).toContainText("~30s left")
  await expect(card.getByTestId("remux-progress-label")).toContainText("1.5x")

  await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-20-remux-progress.png") })
  expect(logins, "the shared storageState must carry auth; no UI login").toHaveLength(0)
})
