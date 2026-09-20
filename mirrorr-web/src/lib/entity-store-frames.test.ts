/**
 * The frame-listener seam V7 uses to raise the `recording.created` toast.
 * `applyFrame` already owns the cache reaction; `subscribeFrames` only mirrors
 * the handled frames to views without duplicating precedence (todo 19 reuses
 * the same seam for the real socket).
 */
import { QueryClient } from "@tanstack/react-query"
import { describe, expect, it, vi } from "vitest"
import { EntityStore, type EntityFrame } from "@/lib/entity-store"
import { queryKeys } from "@/lib/query-keys"

function makeStore(): EntityStore {
  return new EntityStore({ queryClient: new QueryClient() })
}

describe("EntityStore.subscribeFrames", () => {
  it("notifies listeners for every handled frame", async () => {
    const store = makeStore()
    const seen: EntityFrame[] = []
    const unsubscribe = store.subscribeFrames((frame) => seen.push(frame))

    await store.applyFrame({ event: "recording.created", id: 5, data: { id: 5, user_friendly_name: "x" } })
    await store.applyFrame({ event: "recording.deleted", id: 5 })

    expect(seen.map((frame) => frame.event)).toEqual(["recording.created", "recording.deleted"])
    expect(seen[0]?.data).toEqual({ id: 5, user_friendly_name: "x" })
    unsubscribe()
  })

  it("stops notifying after unsubscribe", async () => {
    const store = makeStore()
    const listener = vi.fn()
    store.subscribeFrames(listener)()
    await store.applyFrame({ event: "recording.deleted", id: 5 })
    expect(listener).not.toHaveBeenCalled()
  })

  it("ignores frames for subjects the store does not cache", async () => {
    const store = makeStore()
    const listener = vi.fn()
    store.subscribeFrames(listener)
    await store.applyFrame({ event: "health.updated", id: 1 })
    expect(listener).not.toHaveBeenCalled()
  })

  it("still applies the frame's cache reaction (insert on created)", async () => {
    const client = new QueryClient()
    const store = new EntityStore({ queryClient: client })
    client.setQueryData(queryKeys.recordings(), {
      pages: [{ items: [], next_cursor: null, has_more: false }],
      pageParams: [null],
    })
    store.subscribeFrames(() => undefined)

    await store.applyFrame({ event: "recording.created", id: 7, data: { id: 7, user_friendly_name: "new" } })

    const data = client.getQueryData<{ pages: Array<{ items: Array<{ id: number }> }> }>(queryKeys.recordings())
    expect(data?.pages[0]?.items.map((item) => item.id)).toEqual([7])
  })
})
