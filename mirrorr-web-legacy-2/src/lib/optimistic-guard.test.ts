import { afterEach, describe, expect, it } from "vitest"
import {
  setOptimisticUpdateSource,
  shouldRefetchListOnFrame,
  type PendingOptimisticSource,
} from "@/lib/optimistic-guard"

/**
 * Request-savings rule (`docs/general-client-specification.md` §13.13):
 * "Never refetch the list you just got an optimistic update for; rely on WS
 * coalesced patch; refetch only on `data==null` frames."
 */

afterEach(() => {
  setOptimisticUpdateSource(null)
})

describe("shouldRefetchListOnFrame", () => {
  it("refetches only when the frame carries no data", () => {
    expect(shouldRefetchListOnFrame("sessions", { data: null })).toBe(true)
    expect(shouldRefetchListOnFrame("sessions", { data: { id: 5, status: "live" } })).toBe(false)
  })

  it("never refetches a list that has a pending optimistic update", () => {
    const source: PendingOptimisticSource = (key) => key === "sessions"
    setOptimisticUpdateSource(source)

    expect(shouldRefetchListOnFrame("sessions", { data: null })).toBe(false)
    expect(shouldRefetchListOnFrame("autoruns", { data: null })).toBe(true)
  })

  it("restores the default after the source is reset", () => {
    setOptimisticUpdateSource(() => true)
    expect(shouldRefetchListOnFrame("sessions", { data: null })).toBe(false)

    setOptimisticUpdateSource(null)
    expect(shouldRefetchListOnFrame("sessions", { data: null })).toBe(true)
  })
})
