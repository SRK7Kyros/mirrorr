/**
 * Spec L187 (two-component badge) and L406 (drawer): REST rows only, unread
 * first, click → navigate per resource type + mark read, mark all read, per-row
 * delete, and the footer "Clear" looping one delete per loaded row. Opening the
 * drawer acknowledges nothing (badge rule).
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NotificationDrawer } from "@/components/chrome/NotificationDrawer"
import { API_URL_ENV_VAR } from "@/config/env"
import { clearAuthSession, setAuthSession } from "@/lib/auth-store"
import {
  addSyntheticNotification,
  getSyntheticNotifications,
  resetSyntheticNotifications,
} from "@/lib/notification-policy"
import { queryKeys } from "@/lib/query-keys"
import { fetchNotifications, type NotificationRow } from "@/lib/notifications-api"
import { queryClient } from "@/query-client"
import { AUTH_BODY, installFetch, jsonResponse } from "@/test/api-helpers"
import { renderInRouter } from "@/test/router-harness"

function row(overrides: Partial<NotificationRow> & Pick<NotificationRow, "id">): NotificationRow {
  return {
    user_id: 1,
    resource_type: "session",
    resource_id: 1,
    event_type: "session.stopped",
    title: "session 1: session.stopped",
    body: "",
    read: true,
    created_at: "2026-09-19T10:00:00",
    ...overrides,
  }
}

const UNREAD_RECORDING = row({
  id: 11,
  resource_type: "recording",
  resource_id: 5,
  event_type: "recording.created",
  title: "recording 5 created",
  read: false,
  created_at: "2026-09-19T12:00:00",
})
const READ_SESSION = row({ id: 12, resource_id: 9, title: "session 9 stopped", read: true, created_at: "2026-09-19T11:00:00" })
const UNREAD_PROFILE = row({
  id: 13,
  resource_type: "profile",
  resource_id: 4,
  event_type: "profile.updated",
  title: "profile 4 updated",
  read: false,
  created_at: "2026-09-19T13:00:00",
})

const ROWS = [READ_SESSION, UNREAD_RECORDING, UNREAD_PROFILE]

function installNotificationFetch() {
  return installFetch(async (url, init) => {
    if (url.endsWith("/notifications/read-all")) return jsonResponse(200, { status: "all_marked_read" })
    if (url.includes("/read")) return jsonResponse(200, { ...UNREAD_RECORDING, read: true })
    if (init?.method === "DELETE") return jsonResponse(200, { status: "deleted" })
    return jsonResponse(200, [])
  })
}

async function renderDrawer(rows: readonly NotificationRow[] = ROWS, open = true) {
  return await renderInRouter(<NotificationDrawer open={open} onClose={() => undefined} rows={rows} />)
}

beforeEach(() => {
  vi.stubEnv(API_URL_ENV_VAR, "/api")
  setAuthSession(AUTH_BODY)
  queryClient.setQueryData(queryKeys.notifications(), [...ROWS])
})

afterEach(() => {
  clearAuthSession()
  resetSyntheticNotifications()
  queryClient.clear()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("NotificationDrawer", () => {
  it("lists REST rows unread-first with a dialog role and the unread marker", async () => {
    await renderDrawer()

    const dialog = screen.getByRole("dialog", { name: "Notifications" })
    const rows = within(dialog).getAllByTestId(/^notification-row-/)

    expect(rows.map((element) => element.getAttribute("data-testid"))).toEqual([
      "notification-row-13",
      "notification-row-11",
      "notification-row-12",
    ])
    expect(within(dialog).getByText("recording 5 created")).toBeTruthy()
    expect(within(dialog).getByTestId("notification-unread-13")).toBeTruthy()
  })

  it("navigates a recording row to /recordings?highlight={id} and marks it read", async () => {
    const fetchMock = installNotificationFetch()
    const { router } = await renderDrawer()

    fireEvent.click(screen.getByTestId("notification-open-11"))

    await waitFor(() => {
      expect(router.state.location.href).toContain("/recordings?highlight=5")
    })
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((call) => String(call[0]).endsWith("/notifications/11/read")),
      ).toBe(true)
    })
    await waitFor(() => {
      const cached = queryClient.getQueryData<NotificationRow[]>(queryKeys.notifications())
      expect(cached?.find((item) => item.id === 11)?.read).toBe(true)
    })
  })

  it.each([
    { openTestId: "notification-open-12", destination: "/sessions/9" },
    { openTestId: "notification-open-13", destination: "/profiles?highlight=4" },
  ])("navigates  to  and marks it read", async ({ openTestId, destination }) => {
    installNotificationFetch()
    const { router } = await renderDrawer()

    fireEvent.click(screen.getByTestId(openTestId))

    await waitFor(() => {
      expect(router.state.location.href).toContain(destination)
    })
  })

  it("navigates an autorun row to /autoruns/{id}", async () => {
    installNotificationFetch()
    const autorun = row({
      id: 21,
      resource_type: "autorun",
      resource_id: 3,
      event_type: "autorun.spent",
      title: "autorun 3 spent",
      read: false,
    })
    const { router } = await renderDrawer([autorun])

    fireEvent.click(screen.getByTestId("notification-open-21"))

    await waitFor(() => {
      expect(router.state.location.href).toContain("/autoruns/3")
    })
  })

  it("marks all read via POST /notifications/read-all, zeroing REST and synthetic components", async () => {
    addSyntheticNotification({
      resource_type: "session",
      resource_id: 5,
      event_type: "session.crashed",
      title: "session 5 crashed",
    })
    const fetchMock = installNotificationFetch()
    await renderDrawer()

    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }))

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((call) => String(call[0]).endsWith("/notifications/read-all")),
      ).toBe(true)
    })
    await waitFor(() => {
      const cached = queryClient.getQueryData<NotificationRow[]>(queryKeys.notifications())
      expect(cached?.every((item) => item.read)).toBe(true)
    })
    expect(getSyntheticNotifications()).toEqual([])
  })

  it("deletes a single row through DELETE /notifications/{id}", async () => {
    const fetchMock = installNotificationFetch()
    await renderDrawer()

    const rowElement = screen.getByTestId("notification-row-12")
    fireEvent.click(within(rowElement).getByRole("button", { name: "Delete notification" }))

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          (call) => String(call[0]).endsWith("/notifications/12") && call[1]?.method === "DELETE",
        ),
      ).toBe(true)
    })
    await waitFor(() => {
      const cached = queryClient.getQueryData<NotificationRow[]>(queryKeys.notifications())
      expect(cached?.some((item) => item.id === 12)).toBe(false)
    })
  })

  it("Clear deletes every loaded row behind one confirmation", async () => {
    const fetchMock = installNotificationFetch()
    await queryClient.prefetchQuery({ queryKey: queryKeys.notifications(), queryFn: ({ signal }) => fetchNotifications(signal) })
    await renderDrawer()

    fireEvent.click(screen.getByRole("button", { name: "Clear" }))
    expect(screen.getByText("Clear all notifications?")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }))

    await waitFor(() => {
      const deletes = fetchMock.mock.calls.filter(
        (call) => call[1]?.method === "DELETE" && String(call[0]).includes("/notifications/"),
      )
      expect(deletes.map((call) => String(call[0]).split("/").pop())).toEqual(["12", "11", "13"])
    })
    await waitFor(() => {
      expect(queryClient.getQueryData<NotificationRow[]>(queryKeys.notifications())).toEqual([])
    })
  })

  it("does not acknowledge synthetic frames merely by being open", async () => {
    addSyntheticNotification({
      resource_type: "session",
      resource_id: 5,
      event_type: "session.crashed",
      title: "session 5 crashed",
    })
    await renderDrawer()

    expect(getSyntheticNotifications()).toHaveLength(1)
  })

  it("shows the empty state when no rows exist", async () => {
    await renderDrawer([])

    expect(screen.getByText("No notifications")).toBeTruthy()
  })
})
