import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { Session } from "@/api/schemas"
import { SessionStopDeleteButton } from "./session-stop-delete-button"

const api = vi.hoisted(() => ({
  stopSession: vi.fn().mockResolvedValue(undefined),
  deleteSession: vi.fn().mockResolvedValue(undefined),
  getErrorMessage: vi.fn((_error: unknown, fallback: string) => fallback),
  removeFromInfiniteLists: vi.fn(),
}))

vi.mock("@/api", () => api)

function session(overrides: Partial<Session> = {}): Session {
  return { id: 7, engine_id: 1, resolver_id: 1, status: "recording", ...overrides } as Session
}

function renderButton(overrides: Partial<Session> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <SessionStopDeleteButton session={session(overrides)} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  api.stopSession.mockClear()
  api.deleteSession.mockClear()
})

describe("SessionStopDeleteButton", () => {
  it("stops a live session", async () => {
    renderButton({ status: "recording" })
    fireEvent.click(screen.getByRole("button", { name: /stop session #7/i }))
    await waitFor(() => expect(api.stopSession).toHaveBeenCalledWith(7))
  })

  it("asks before deleting a spent session", () => {
    renderButton({ status: "completed" })
    fireEvent.click(screen.getByRole("button", { name: /delete session #7/i }))
    expect(api.deleteSession).not.toHaveBeenCalled()
    expect(screen.getByText("Delete session #7?")).toBeTruthy()
  })

  it("renders nothing for a status with no terminal action", () => {
    renderButton({ status: "remuxing" })
    expect(screen.queryByRole("button")).toBeNull()
  })
})
