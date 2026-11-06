import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { NotificationBell } from "./notification-bell"

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...rest }: { readonly children?: ReactNode }) => <a {...rest}>{children}</a>,
}))

const api = vi.hoisted(() => ({
  auth: { user: { id: 1, username: "kyros", role: "admin", display_name: "Kyros" } },
  list: [] as unknown[],
}))

vi.mock("@/api", () => ({
  useAuthState: () => ({ auth: { user: api.auth.user } }),
  useNotifications: () => ({
    data: api.list,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

vi.mock("@/api/hooks", () => ({
  useMarkNotificationRead: () => ({ mutate: vi.fn(), isPending: false }),
  useMarkAllNotificationsRead: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteNotification: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}))

describe("NotificationBell", () => {
  it("opens the drawer and hands focus back to the bell on Escape", async () => {
    render(<NotificationBell />)
    const bell = screen.getByRole("button", { name: "Notifications" })

    // A real click focuses the button before it fires; jsdom's `fireEvent.click`
    // does not, so focus it the way the browser would.
    bell.focus()
    fireEvent.click(bell)
    await screen.findByRole("dialog")

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(bell))
  })

  it("counts unread rows in its own name", () => {
    api.list = [
      { id: 1, resource_type: "session", resource_id: 3, event_type: "session.stopped", title: "x", created_at: "" },
      { id: 2, resource_type: "session", resource_id: 4, event_type: "session.stopped", title: "x", created_at: "", read: true },
    ]
    render(<NotificationBell />)
    expect(screen.getByRole("button", { name: "Notifications, 1 unread" })).toBeTruthy()
    api.list = []
  })
})
