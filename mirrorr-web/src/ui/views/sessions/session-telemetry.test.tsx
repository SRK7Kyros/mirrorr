import { describe, expect, it, vi } from "vitest"
import { act, render, screen } from "@testing-library/react"
import { SessionTelemetryReadout } from "./session-telemetry"

const api = vi.hoisted(() => {
  const state = {
    sessionId: null as number | null,
    listener: null as ((telemetry: unknown) => void) | null,
  }
  return {
    state,
    subscribeSessionTelemetry: (
      sessionId: number,
      listener: (telemetry: unknown) => void,
    ) => {
      state.sessionId = sessionId
      state.listener = listener
      return () => {
        state.listener = null
      }
    },
  }
})

vi.mock("@/api", () => api)

describe("SessionTelemetryReadout", () => {
  it("renders nothing until a frame arrives, then lists every process", () => {
    const { container } = render(<SessionTelemetryReadout sessionId={5} />)

    expect(api.state.sessionId).toBe(5)
    expect(container.querySelector('[data-slot="session-telemetry"]')).toBeNull()

    act(() => {
      api.state.listener?.({
        processes: [
          { name: "engine", cpu_percent: 12.5, rss_bytes: 2048 },
          { name: "streamlink", cpu_percent: 0, rss_bytes: 1024 },
        ],
        total_rss_bytes: 3072,
      })
    })

    expect(container.querySelector('[data-slot="session-telemetry"]')).not.toBeNull()
    expect(screen.getByText("engine")).not.toBeNull()
    expect(screen.getByText("12.5% · 2.0 KB")).not.toBeNull()
    expect(screen.getByText("0.0% · 1.0 KB")).not.toBeNull()
    expect(screen.getByText("RSS 3.0 KB")).not.toBeNull()
  })

  it("drops the readout when the session changes", () => {
    const { container, rerender } = render(<SessionTelemetryReadout sessionId={5} />)

    act(() => {
      api.state.listener?.({ processes: [{ name: "engine" }], total_rss_bytes: 0 })
    })
    expect(container.querySelector('[data-slot="session-telemetry"]')).not.toBeNull()

    rerender(<SessionTelemetryReadout sessionId={6} />)
    expect(container.querySelector('[data-slot="session-telemetry"]')).toBeNull()
  })
})
