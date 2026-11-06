import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import type { Notification } from "@/api/schemas"
import { NotificationDrawer, type NotificationQuery } from "./notification-drawer"

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params: _params,
    search: _search,
    children,
    ...rest
  }: {
    readonly to?: string
    readonly params?: unknown
    readonly search?: unknown
    readonly children?: ReactNode
  }) => (
    <a href={typeof to === "string" ? to : "#"} {...rest}>
      {children}
    </a>
  ),
}))

const mutations = vi.hoisted(() => ({
  markRead: vi.fn(),
  markAll: vi.fn(),
  remove: vi.fn(),
  removeAsync: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/api/hooks", () => ({
  useMarkNotificationRead: () => ({ mutate: mutations.markRead, isPending: false }),
  useMarkAllNotificationsRead: () => ({ mutate: mutations.markAll, isPending: false }),
  useDeleteNotification: () => ({
    mutate: mutations.remove,
    mutateAsync: mutations.removeAsync,
    isPending: false,
  }),
}))

function notification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 1,
    resource_type: "session",
    resource_id: 913,
    event_type: "session.stopped",
    title: "Session stopped",
    created_at: "2026-11-06T12:00:00Z",
    ...overrides,
  }
}

function query(overrides: Partial<NotificationQuery> = {}): NotificationQuery {
  return {
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  }
}

function renderDrawer(overrides: Partial<NotificationQuery> = {}) {
  return render(<NotificationDrawer open onClose={vi.fn()} query={query(overrides)} />)
}

describe("NotificationDrawer", () => {
  it("renders human copy and a link to the object each row is about", () => {
    renderDrawer({ data: [notification()] })
    expect(screen.getByText("Session #913 stopped")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Open session #913" })).toBeTruthy()
  })

  it("never shows the empty state while the request is still loading", () => {
    renderDrawer({ isLoading: true })
    expect(screen.getByRole("status", { name: "Loading notifications" })).toBeTruthy()
    expect(screen.queryByText("No notifications")).toBeNull()
  })

  it("shows a retryable error, never 'No notifications', when the request failed", () => {
    const refetch = vi.fn()
    renderDrawer({ isError: true, error: new Error("boom"), refetch })
    expect(screen.queryByText("No notifications")).toBeNull()
    expect(screen.getByText("boom")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(refetch).toHaveBeenCalled()
  })

  it("offers the empty state only when the list really is empty", () => {
    renderDrawer({ data: [] })
    expect(screen.getByText("No notifications")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Mark all read" }).hasAttribute("disabled")).toBe(true)
  })

  it("names the notification and confirms before deleting it", async () => {
    renderDrawer({ data: [notification()] })
    fireEvent.click(screen.getByRole("button", { name: "Delete “Session #913 stopped”" }))
    expect(mutations.removeAsync).not.toHaveBeenCalled()
    expect(screen.getByText("Delete “Session #913 stopped”?")).toBeTruthy()
    expect(screen.getByText(/the session, autorun or recording it names is not touched/)).toBeTruthy()
  })

  it("marks a single row read from its own control", () => {
    renderDrawer({ data: [notification()] })
    fireEvent.click(screen.getByRole("button", { name: "Mark “Session #913 stopped” read" }))
    expect(mutations.markRead).toHaveBeenCalledWith(1, expect.anything())
  })
})
