/**
 * Todo 27 acceptance (spec L169 mobile lifecycle, L573 notifications/badge):
 * the background grace, the resume reconnect + single refetch, the toast gate
 * for frames that land while backgrounded, and the no-duplicate re-flush.
 */
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BACKGROUND_GRACE_MS, installAppLifecycle, isAppBackgrounded } from "@/lib/app-lifecycle"
import { EntityStore } from "@/lib/entity-store"
import {
  getSyntheticNotifications,
  handleNotificationFrame,
  resetSyntheticNotifications,
} from "@/lib/notification-policy"
import { queryKeys } from "@/lib/query-keys"
import { clearToasts, getToasts } from "@/lib/toast"

function createVisibilitySource() {
  const listeners = new Set<(hidden: boolean) => void>()
  return {
    subscribe(listener: (hidden: boolean) => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    emit(hidden: boolean): void {
      for (const listener of [...listeners]) listener(hidden)
    },
  }
}

function createManualTimers() {
  const pending = new Map<number, () => void>()
  let nextHandle = 1
  return {
    setTimer: (callback: () => void): number => {
      const handle = nextHandle
      nextHandle += 1
      pending.set(handle, callback)
      return handle
    },
    clearTimer: (handle: number): void => {
      pending.delete(handle)
    },
    fire(): void {
      const callbacks = [...pending.values()]
      pending.clear()
      for (const callback of callbacks) callback()
    },
    get pendingCount(): number {
      return pending.size
    },
  }
}

interface ListPages {
  readonly pages: Array<{ items: Array<{ id: number }> }>
}

describe("installAppLifecycle", () => {
  afterEach(() => {
    clearToasts()
    resetSyntheticNotifications()
  })

  it("keeps the sockets open through a short background and refetches once on return", () => {
    const visibility = createVisibilitySource()
    const timers = createManualTimers()
    const pause = vi.fn()
    const resume = vi.fn()
    const refetchVisible = vi.fn()
    let clock = 1_000

    const uninstall = installAppLifecycle({
      subscribeVisibility: visibility.subscribe,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      now: () => clock,
      pause,
      resume,
      refetchVisible,
    })

    visibility.emit(true)
    expect(isAppBackgrounded()).toBe(true)

    clock += BACKGROUND_GRACE_MS - 1_000
    visibility.emit(false)

    expect(timers.pendingCount).toBe(0)
    expect(pause).not.toHaveBeenCalled()
    expect(resume).not.toHaveBeenCalled()
    expect(refetchVisible).toHaveBeenCalledTimes(1)
    expect(isAppBackgrounded()).toBe(false)
    uninstall()
  })

  it("closes the sockets deliberately past the grace, then reconnects and refetches on resume", () => {
    const visibility = createVisibilitySource()
    const timers = createManualTimers()
    const pause = vi.fn()
    const resume = vi.fn()
    const refetchVisible = vi.fn()

    const uninstall = installAppLifecycle({
      subscribeVisibility: visibility.subscribe,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      pause,
      resume,
      refetchVisible,
    })

    visibility.emit(true)
    expect(timers.pendingCount).toBe(1)
    expect(pause).not.toHaveBeenCalled()

    timers.fire()
    expect(pause).toHaveBeenCalledTimes(1)
    expect(resume).not.toHaveBeenCalled()

    visibility.emit(false)
    expect(resume).toHaveBeenCalledTimes(1)
    expect(refetchVisible).toHaveBeenCalledTimes(1)
    uninstall()
  })

  it("ignores a visible event that was never preceded by a hidden one", () => {
    const visibility = createVisibilitySource()
    const resume = vi.fn()
    const refetchVisible = vi.fn()

    const uninstall = installAppLifecycle({
      subscribeVisibility: visibility.subscribe,
      resume,
      refetchVisible,
    })

    visibility.emit(false)
    expect(resume).not.toHaveBeenCalled()
    expect(refetchVisible).not.toHaveBeenCalled()
    uninstall()
  })

  it("refetches the four visible lists on a foreground transition", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const visibility = createVisibilitySource()
    const spies = {
      sessions: vi.fn(async () => []),
      autoruns: vi.fn(async () => []),
      recordings: vi.fn(async () => []),
      profiles: vi.fn(async () => []),
    }

    const uninstall = installAppLifecycle({
      subscribeVisibility: visibility.subscribe,
      refetchVisible: () => {
        void client.refetchQueries({ type: "active" })
      },
    })

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )

    renderHook(
      () => {
        useQuery({ queryKey: queryKeys.sessions(), queryFn: spies.sessions })
        useQuery({ queryKey: queryKeys.autoruns(), queryFn: spies.autoruns })
        useQuery({ queryKey: queryKeys.recordings(), queryFn: spies.recordings })
        useQuery({ queryKey: queryKeys.profiles(), queryFn: spies.profiles })
      },
      { wrapper },
    )

    await waitFor(() => {
      expect(spies.sessions).toHaveBeenCalledTimes(1)
      expect(spies.autoruns).toHaveBeenCalledTimes(1)
      expect(spies.recordings).toHaveBeenCalledTimes(1)
      expect(spies.profiles).toHaveBeenCalledTimes(1)
    })

    act(() => {
      visibility.emit(true)
      visibility.emit(false)
    })

    await waitFor(() => {
      expect(spies.sessions).toHaveBeenCalledTimes(2)
      expect(spies.autoruns).toHaveBeenCalledTimes(2)
      expect(spies.recordings).toHaveBeenCalledTimes(2)
      expect(spies.profiles).toHaveBeenCalledTimes(2)
    })
    uninstall()
  })

  it("counts a backgrounded frame toward the badge without a toast and never replays it", () => {
    const visibility = createVisibilitySource()
    const uninstall = installAppLifecycle({ subscribeVisibility: visibility.subscribe })
    const frame = { event_type: "session.crashed", title: "Session #12 failed" }

    visibility.emit(true)
    expect(handleNotificationFrame(frame)).toBe(false)
    expect(getSyntheticNotifications()).toHaveLength(1)
    expect(getToasts()).toHaveLength(0)

    visibility.emit(false)
    expect(getToasts()).toHaveLength(0)
    expect(getSyntheticNotifications()).toHaveLength(1)
    uninstall()
  })

  it("keeps a single row when a reconnect re-flushes the same entity", async () => {
    const client = new QueryClient()
    const store = new EntityStore({ queryClient: client })
    client.setQueryData(queryKeys.recordings(), {
      pages: [{ items: [{ id: 7, user_friendly_name: "x" }], next_cursor: null, has_more: false }],
      pageParams: [null],
    })

    await store.applyFrame({ event: "recording.updated", id: 7, data: { id: 7, user_friendly_name: "x" } })
    await store.applyFrame({ event: "recording.updated", id: 7, data: { id: 7, user_friendly_name: "x" } })

    const data = client.getQueryData<ListPages>(queryKeys.recordings())
    expect(data?.pages[0]?.items).toHaveLength(1)
  })
})
