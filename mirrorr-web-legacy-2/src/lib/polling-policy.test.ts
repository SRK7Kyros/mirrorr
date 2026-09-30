/**
 * Todo 21 acceptance (spec L140, L154-L158, L171): the polling-backstop
 * interval selection — principal type × realtime state × surface — and the
 * exact spec cadences. This module is the ONLY place those three numbers are
 * chosen; the views pass the result straight into `refetchInterval` /
 * `refetchOnWindowFocus`, and `src/lib/query-keys.ts` is the single source of
 * the millisecond values.
 */
import { describe, expect, it } from "vitest"
import { QUERY_POLL_INTERVALS_MS } from "@/lib/query-keys"
import { selectPollingPolicy } from "@/lib/polling-policy"

describe("QUERY_POLL_INTERVALS_MS", () => {
  it("pins the spec's three cadences", () => {
    expect(QUERY_POLL_INTERVALS_MS).toEqual({
      entityBackstop: 30_000,
      offlineFallback: 15_000,
      apiClient: 10_000,
    })
  })
})

describe("selectPollingPolicy: user principal", () => {
  it("runs the 30s backstop plus focus refetch on a live list", () => {
    expect(selectPollingPolicy("user", "live", "list")).toEqual({
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
    })
  })

  it("runs the 30s backstop plus focus refetch on a live detail", () => {
    expect(selectPollingPolicy("user", "live", "detail")).toEqual({
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
    })
  })

  it("keeps the 30s backstop while the socket is reconnecting", () => {
    expect(selectPollingPolicy("user", "reconnecting", "list")).toEqual({
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
    })
  })

  it("gives admin surfaces focus refetch without a backstop interval", () => {
    expect(selectPollingPolicy("user", "live", "admin")).toEqual({
      refetchInterval: false,
      refetchOnWindowFocus: true,
    })
  })

  it("switches every surface to the 15s fallback once the socket is offline", () => {
    for (const surface of ["list", "detail", "admin"] as const) {
      expect(selectPollingPolicy("user", "offline", surface)).toEqual({
        refetchInterval: 15_000,
        refetchOnWindowFocus: true,
      })
    }
  })
})

describe("selectPollingPolicy: API-client principal", () => {
  it("forces the 10s cadence on lists regardless of socket state", () => {
    for (const realtime of ["live", "reconnecting", "offline"] as const) {
      expect(selectPollingPolicy("api-client", realtime, "list")).toEqual({
        refetchInterval: 10_000,
        refetchOnWindowFocus: true,
      })
    }
  })

  it("forces the 10s cadence on open details", () => {
    expect(selectPollingPolicy("api-client", "live", "detail")).toEqual({
      refetchInterval: 10_000,
      refetchOnWindowFocus: true,
    })
  })

  it("never downgrades to the 15s fallback — 10s is already stricter", () => {
    expect(selectPollingPolicy("api-client", "offline", "list").refetchInterval).toBe(10_000)
  })
})
