import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { API_URL_ENV_VAR } from "@/config/env"
import {
  MIN_REFRESH_AGE_MS,
  PROACTIVE_REFRESH_INTERVAL_MS,
  apiFetch,
  markSessionRefreshed,
  resetSession,
  setAuthTransport,
  setForcedLogoutHandler,
  startProactiveRefresh,
  type VisibilityEventSource,
} from "@/lib/api"
import { ApiParseError, userMessageForError } from "@/lib/errors"
import { cursorPageSchema } from "@/lib/schemas/pagination"
import { AUTH_BODY, installFetch, jsonResponse } from "@/test/api-helpers"

const sessionsPageSchema = cursorPageSchema(z.object({ id: z.number() }))

/** Test-local consumer proving the parse-error copy a view will render. */
function ParseFailureView({ error }: { error: unknown }) {
  return <p role="alert">{userMessageForError(error)}</p>
}

class FakeVisibilitySource implements VisibilityEventSource {
  private readonly listeners = new Set<() => void>()

  addEventListener(_type: "visibilitychange", listener: () => void): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: "visibilitychange", listener: () => void): void {
    this.listeners.delete(listener)
  }

  emit(): void {
    for (const listener of this.listeners) listener()
  }

  get listenerCount(): number {
    return this.listeners.size
  }
}

function installFakeTimers() {
  const callbacks: Array<() => void> = []
  const setIntervalFn = vi.fn((callback: () => void, _intervalMs: number) => {
    callbacks.push(callback)
    return 1
  })
  const clearIntervalFn = vi.fn()

  return {
    setIntervalFn,
    clearIntervalFn,
    tick: () => {
      for (const callback of callbacks) callback()
    },
  }
}

beforeEach(() => {
  vi.stubEnv(API_URL_ENV_VAR, "/api")
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetSession()
  setForcedLogoutHandler(null)
  setAuthTransport({ kind: "cookie" })
})

describe("Zod parse policy", () => {
  it("warns, refetches once, then renders the fixed parse-error copy", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const fetchMock = installFetch(async () => jsonResponse(200, { unexpected: true }))

    const error = await apiFetch("/sessions/", { schema: sessionsPageSchema }).catch(
      (cause: unknown) => cause,
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(warnSpy).toHaveBeenCalledTimes(2)
    expect(error).toBeInstanceOf(ApiParseError)

    render(<ParseFailureView error={error} />)
    expect(screen.getByRole("alert").textContent).toBe("Unexpected server response")
  })

  it("recovers when the refetched body matches the schema", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    let calls = 0
    installFetch(async () => {
      calls += 1
      return calls === 1
        ? jsonResponse(200, { unexpected: true })
        : jsonResponse(200, { items: [{ id: 7 }], next_cursor: null, has_more: false })
    })

    const page = await apiFetch("/sessions/", { schema: sessionsPageSchema })

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(page?.items).toEqual([{ id: 7 }])
  })
})

describe("proactive refresh", () => {
  it("refreshes on the 23h timer when the last refresh is older than 1h", async () => {
    const source = new FakeVisibilitySource()
    const { setIntervalFn, clearIntervalFn, tick } = installFakeTimers()
    const fetchMock = installFetch(async () => jsonResponse(200, AUTH_BODY))
    const now = 1_000_000_000_000

    markSessionRefreshed(now - MIN_REFRESH_AGE_MS - 1)
    const stop = startProactiveRefresh({
      now: () => now,
      setIntervalFn,
      clearIntervalFn,
      visibilitySource: source,
      getVisibilityState: () => "hidden",
    })

    expect(setIntervalFn).toHaveBeenCalledWith(expect.any(Function), PROACTIVE_REFRESH_INTERVAL_MS)
    tick()
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/auth/refresh")

    stop()
    expect(clearIntervalFn).toHaveBeenCalledWith(1)
    expect(source.listenerCount).toBe(0)
  })

  it("skips the 23h tick when the last refresh is within the hour", async () => {
    const { setIntervalFn, tick } = installFakeTimers()
    const fetchMock = installFetch(async () => jsonResponse(200, AUTH_BODY))
    const now = 1_100_000_000_000

    markSessionRefreshed(now - MIN_REFRESH_AGE_MS)
    const stop = startProactiveRefresh({
      now: () => now,
      setIntervalFn,
      clearIntervalFn: () => undefined,
      visibilitySource: new FakeVisibilitySource(),
      getVisibilityState: () => "hidden",
    })

    tick()
    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()
    stop()
  })

  it("refreshes on visibilitychange only when visible and stale", async () => {
    const source = new FakeVisibilitySource()
    let visibility: DocumentVisibilityState = "hidden"
    const fetchMock = installFetch(async () => jsonResponse(200, AUTH_BODY))
    const now = 2_000_000_000_000

    markSessionRefreshed(now - MIN_REFRESH_AGE_MS - 1)
    const stop = startProactiveRefresh({
      now: () => now,
      setIntervalFn: () => 1,
      clearIntervalFn: () => undefined,
      visibilitySource: source,
      getVisibilityState: () => visibility,
    })

    source.emit()
    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()

    visibility = "visible"
    source.emit()
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    stop()
  })

  it("skips visibilitychange when the last refresh is fresh", async () => {
    const source = new FakeVisibilitySource()
    const fetchMock = installFetch(async () => jsonResponse(200, AUTH_BODY))
    const now = 3_000_000_000_000

    markSessionRefreshed(now - MIN_REFRESH_AGE_MS + 60_000)
    const stop = startProactiveRefresh({
      now: () => now,
      setIntervalFn: () => 1,
      clearIntervalFn: () => undefined,
      visibilitySource: source,
      getVisibilityState: () => "visible",
    })

    source.emit()
    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()
    stop()
  })
})
