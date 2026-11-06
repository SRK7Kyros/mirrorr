import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { Session } from "@/api/schemas"
import { SessionStopDeleteButton } from "./session-stop-delete-button"

const api = vi.hoisted(() => ({
  stopSession: vi.fn().mockResolvedValue(undefined),
  getErrorMessage: vi.fn((_error: unknown, fallback: string) => fallback),
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
})

describe("SessionStopDeleteButton", () => {
  it("is one labelled verb and confirms, naming the run, before stopping", async () => {
    renderButton({ status: "recording", autorun_name: "F1 Weekend" })

    fireEvent.click(screen.getByRole("button", { name: "Stop recording session #7" }))
    expect(api.stopSession).not.toHaveBeenCalled()

    expect(screen.getByText("Stop recording session #7?")).toBeTruthy()
    expect(screen.getByText(/“F1 Weekend” ends its capture now/)).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }))
    await waitFor(() => expect(api.stopSession).toHaveBeenCalledWith(7))
  })

  it("confirms without a name when the run has none", () => {
    renderButton({ status: "initializing" })
    fireEvent.click(screen.getByRole("button", { name: "Stop recording session #7" }))
    expect(screen.getByText(/The capture ends now and the file written so far is kept/)).toBeTruthy()
  })

  it("renders nothing once the run is spent — delete lives in the overflow", () => {
    renderButton({ status: "completed" })
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("renders nothing for a status with no terminal action", () => {
    renderButton({ status: "remuxing" })
    expect(screen.queryByRole("button")).toBeNull()
  })
})
