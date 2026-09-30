import type { InfiniteData } from "@tanstack/react-query"
import { QueryClient } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"
import { EntityStore } from "@/lib/entity-store"
import type { EntityValues } from "@/lib/entity-merge"
import { ApiError } from "@/lib/errors"
import {
  createEntity,
  deleteEntity,
  markRead,
  stopEntity,
  toggleRecording,
  DELETE_POLL_FALLBACK_MS,
} from "@/lib/optimistic-policy"
import { queryKeys } from "@/lib/query-keys"
import type { CursorPage } from "@/lib/schemas/pagination"

/**
 * The per-action optimism policy (`docs/web-frontend-spec.md` L141-L150):
 *
 * (d) a 409 on the recording toggle restores the previous value;
 * (e) a failed mark-read rolls back the badge and toasts;
 * plus create-not-optimistic, stop-pending-only, the delete WS wait with its
 * 15s poll fallback, and "deleted cancels pending" staying silent.
 */

interface Row extends EntityValues {
  readonly status?: string
  readonly record?: boolean
  readonly read?: boolean
}

function infiniteRows(items: readonly Row[]): InfiniteData<CursorPage<Row>, null> {
  return { pages: [{ items, next_cursor: null, has_more: false }], pageParams: [null] }
}

function rawRows(client: QueryClient, key: readonly unknown[]): Row[] {
  const data = client.getQueryData<InfiniteData<CursorPage<Row>, null>>(key)
  if (data === undefined) return []
  return data.pages.flatMap((page) => [...page.items])
}

function makeStore() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const refetchEntity = vi.fn(async () => undefined)
  const store = new EntityStore({ queryClient: client, refetchEntity })
  return { client, store, refetchEntity }
}

afterEach(() => {
  vi.useRealTimers()
})

describe("createEntity", () => {
  it("is not optimistic: nothing is cached until the mutation resolves", async () => {
    const { client, store } = makeStore()
    client.setQueryData(queryKeys.sessions(), infiniteRows([{ id: 7, status: "completed" }]))
    let release!: (row: Row) => void
    const mutate = () =>
      new Promise<Row>((resolve) => {
        release = resolve
      })

    const call = createEntity(store, { resource: "session", mutate })

    expect(rawRows(client, queryKeys.sessions()).filter((row) => row.id === 42)).toHaveLength(0)
    expect(store.getPending("session", 42)).toBeUndefined()

    release({ id: 42, status: "active" })
    await expect(call).resolves.toMatchObject({ id: 42 })
    expect(rawRows(client, queryKeys.sessions()).filter((row) => row.id === 42)).toHaveLength(1)
  })
})

describe("stopEntity", () => {
  it("is pending-only: no status guess, and the pending survives until the WS snapshot", async () => {
    const { client, store } = makeStore()
    client.setQueryData(queryKeys.session(5), { id: 5, status: "recording" })

    await stopEntity(store, { resource: "session", id: 5, mutate: async () => undefined })

    expect(client.getQueryData(queryKeys.session(5))).toEqual({ id: 5, status: "recording" })
    expect(store.getPending("session", 5)?.kind).toBe("stop")

    store.applyFrame({ event: "session.updated", id: 5, data: { id: 5, status: "terminating" } })

    expect(store.getPending("session", 5)).toBeUndefined()
    expect(client.getQueryData(queryKeys.session(5))).toMatchObject({ status: "terminating" })
  })

  it("clears the pending state when the request fails", async () => {
    const { store } = makeStore()

    await expect(
      stopEntity(store, {
        resource: "session",
        id: 5,
        mutate: async () => {
          throw new ApiError({ status: 502, detail: "Control unavailable" })
        },
      }),
    ).rejects.toBeInstanceOf(ApiError)

    expect(store.getPending("session", 5)).toBeUndefined()
  })
})

describe("toggleRecording", () => {
  it("flips via the pending overlay and reverts the previous value on 409", async () => {
    const { client, store } = makeStore()
    client.setQueryData(queryKeys.session(7), { id: 7, record: true })

    let rejectToggle!: (error: unknown) => void
    const call = toggleRecording(store, {
      resource: "session",
      id: 7,
      optimisticFields: { record: false },
      mutate: () =>
        new Promise<void>((_resolve, reject) => {
          rejectToggle = reject
        }),
    })

    // Optimistic flip lives in the pending overlay, never in the entity cache.
    expect(store.getPendingFields("session", 7)).toEqual({ record: false })
    expect(client.getQueryData(queryKeys.session(7))).toEqual({ id: 7, record: true })

    rejectToggle(new ApiError({ status: 409, detail: "Already recording" }))
    await expect(call).rejects.toBeInstanceOf(ApiError)

    expect(store.getPendingFields("session", 7)).toBeUndefined()
    expect(store.getPending("session", 7)).toBeUndefined()
    expect(client.getQueryData(queryKeys.session(7))).toEqual({ id: 7, record: true })
  })

  it("reverts on 400 as well", async () => {
    const { store } = makeStore()
    const call = toggleRecording(store, {
      resource: "session",
      id: 7,
      optimisticFields: { record: true },
      mutate: async () => {
        throw new ApiError({ status: 400, detail: "Bad request" })
      },
    })

    await expect(call).rejects.toBeInstanceOf(ApiError)
    expect(store.getPending("session", 7)).toBeUndefined()
  })

  it("does not revert on any other status (and only 400/409 revert)", async () => {
    const { store } = makeStore()
    const call = toggleRecording(store, {
      resource: "session",
      id: 7,
      optimisticFields: { record: true },
      mutate: async () => {
        throw new ApiError({ status: 500, detail: "Boom" })
      },
    })

    await expect(call).rejects.toBeInstanceOf(ApiError)
    expect(store.getPendingFields("session", 7)).toEqual({ record: true })

    store.applyFrame({ event: "session.updated", id: 7, data: { id: 7, record: false } })
    expect(store.getPending("session", 7)).toBeUndefined()
  })

  it("keeps the overlay after success until the WS status flip", async () => {
    const { store } = makeStore()

    await toggleRecording(store, {
      resource: "session",
      id: 7,
      optimisticFields: { record: false },
      mutate: async () => undefined,
    })

    expect(store.getPendingFields("session", 7)).toEqual({ record: false })
    store.applyFrame({ event: "session.updated", id: 7, data: { id: 7, record: false } })
    expect(store.getPending("session", 7)).toBeUndefined()
  })
})

describe("deleteEntity", () => {
  it("waits for the WS deleted event and polls only after the 15s fallback", async () => {
    vi.useFakeTimers()
    const { store, refetchEntity } = makeStore()

    await deleteEntity(store, { resource: "session", id: 5, mutate: async () => undefined })

    expect(store.getPending("session", 5)?.kind).toBe("delete")
    expect(refetchEntity).not.toHaveBeenCalled()

    vi.advanceTimersByTime(DELETE_POLL_FALLBACK_MS)
    expect(refetchEntity).toHaveBeenCalledTimes(1)
    expect(refetchEntity).toHaveBeenCalledWith("session", 5)

    store.applyFrame({ event: "session.deleted", id: 5 })

    expect(store.getPending("session", 5)).toBeUndefined()
    vi.advanceTimersByTime(DELETE_POLL_FALLBACK_MS * 2)
    expect(refetchEntity).toHaveBeenCalledTimes(1)
  })

  it("clears the pending state when the DELETE fails", async () => {
    const { store } = makeStore()

    await expect(
      deleteEntity(store, {
        resource: "session",
        id: 5,
        mutate: async () => {
          throw new ApiError({ status: 404, detail: "Gone" })
        },
      }),
    ).rejects.toBeInstanceOf(ApiError)

    expect(store.getPending("session", 5)).toBeUndefined()
  })
})

describe("markRead", () => {
  it("rolls the badge back and toasts when the request fails", async () => {
    const { store } = makeStore()
    const notify = vi.fn()
    const badge = () => (store.getPendingFields("notification", 3)?.read === true ? 0 : 1)

    expect(badge()).toBe(1)

    const call = markRead(store, {
      resource: "notification",
      id: 3,
      optimisticFields: { read: true },
      rollbackMessage: "Could not mark as read",
      mutate: async () => {
        throw new Error("network down")
      },
      notify,
    })

    expect(badge()).toBe(0)

    await expect(call).rejects.toThrow("network down")

    expect(badge()).toBe(1)
    expect(store.getPending("notification", 3)).toBeUndefined()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith("Could not mark as read")
  })

  it("writes the authoritative entity on success and clears the overlay", async () => {
    const { client, store } = makeStore()
    client.setQueryData(queryKeys.notifications(), infiniteRows([{ id: 3, read: false }]))

    await markRead(store, {
      resource: "notification",
      id: 3,
      optimisticFields: { read: true },
      rollbackMessage: "Could not mark as read",
      mutate: async () => ({ id: 3, read: true }),
    })

    expect(store.getPending("notification", 3)).toBeUndefined()
    expect(rawRows(client, queryKeys.notifications())[0]).toMatchObject({ id: 3, read: true })
  })

  it("stays silent when a deleted frame cancels the pending mark-read", async () => {
    const { store } = makeStore()
    const notify = vi.fn()
    let rejectRead!: (error: unknown) => void

    const call = markRead(store, {
      resource: "notification",
      id: 3,
      optimisticFields: { read: true },
      rollbackMessage: "Could not mark as read",
      mutate: () =>
        new Promise<undefined>((_resolve, reject) => {
          rejectRead = reject
        }),
      notify,
    })

    store.applyFrame({ event: "notification.deleted", id: 3 })

    rejectRead(new Error("request died after the row was deleted"))
    await expect(call).rejects.toThrow("request died after the row was deleted")

    expect(notify).not.toHaveBeenCalled()
    expect(store.getPending("notification", 3)).toBeUndefined()
  })
})
