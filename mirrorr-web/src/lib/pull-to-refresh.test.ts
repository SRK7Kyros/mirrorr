/**
 * Todo 25 (spec L506): the pull-to-refresh contract. The load-bearing assertion
 * is the equivalence with window focus — the refresh must run exactly the work
 * a focus runs (the active stale queries, name maps included) and must not
 * touch inactive or fresh queries.
 */
import { QueryClient, QueryObserver, focusManager } from "@tanstack/react-query"
import { afterEach, describe, expect, it } from "vitest"
import {
  PULL_TO_REFRESH_THRESHOLD_PX,
  isPullToRefreshRoute,
  isRefreshArmed,
  pullDistance,
  refetchForPullToRefresh,
} from "@/lib/pull-to-refresh"

/** Flushes the microtask queue plus one macrotask so refetches have landed. */
async function settle(): Promise<void> {
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * A mounted observer is what makes a query "active" (and therefore eligible for
 * a focus refetch). The returned release drops the subscription, which is what
 * turns the query inactive again.
 */
function observe(
  client: QueryClient,
  key: readonly unknown[],
  calls: string[],
  options: { staleTime?: number } = {},
): () => void {
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: async () => {
      calls.push(String(key[0]))
      return key[0]
    },
    ...options,
  })
  return observer.subscribe(() => undefined)
}

async function buildFixture(): Promise<{
  client: QueryClient
  calls: string[]
  release: () => void
}> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // `mount()` is what subscribes the cache to the focus manager, exactly as
  // QueryClientProvider does in the app.
  client.mount()

  const calls: string[] = []
  const releaseList = observe(client, ["sessions"], calls)
  const releaseNames = observe(client, ["names"], calls)
  const releaseFresh = observe(client, ["fresh"], calls, { staleTime: Number.POSITIVE_INFINITY })
  const releaseInactive = observe(client, ["inactive"], calls)

  // Warm every cache entry so staleness (not "no data yet") decides the refetch.
  await settle()
  releaseInactive()
  calls.length = 0

  return {
    client,
    calls,
    release: () => {
      releaseList()
      releaseNames()
      releaseFresh()
      client.unmount()
    },
  }
}

afterEach(() => {
  focusManager.setFocused(true)
})

describe("pull-to-refresh geometry", () => {
  it("only arms past the spec's 64px threshold", () => {
    expect(PULL_TO_REFRESH_THRESHOLD_PX).toBe(64)
    expect(isRefreshArmed(63)).toBe(false)
    expect(isRefreshArmed(64)).toBe(true)
  })

  it("treats an upward drag as no pull at all", () => {
    expect(pullDistance(300, 240)).toBe(0)
    expect(pullDistance(240, 304)).toBe(64)
  })

  it("enables the gesture on the four lists only", () => {
    for (const path of ["/sessions", "/autoruns", "/recordings", "/profiles"]) {
      expect(isPullToRefreshRoute(path)).toBe(true)
    }
    for (const path of ["/sessions/5", "/settings", "/plugins", "/", "/import-export"]) {
      expect(isPullToRefreshRoute(path)).toBe(false)
    }
  })
})

describe("refetchForPullToRefresh", () => {
  it("refetches exactly the queries a window focus refetches", async () => {
    const fixture = await buildFixture()

    focusManager.setFocused(false)
    focusManager.setFocused(true)
    await settle()
    const onFocus = [...fixture.calls].sort()

    fixture.calls.length = 0
    refetchForPullToRefresh(fixture.client)
    await settle()
    const onPull = [...fixture.calls].sort()

    // The active stale list + name map refetch; the fresh and the inactive
    // queries do not.
    expect(onFocus).toEqual(["names", "sessions"])
    expect(onPull).toEqual(onFocus)

    fixture.release()
  })

  it("is inert when no query is active and stale", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.mount()
    const calls: string[] = []
    const release = observe(client, ["fresh-only"], calls, {
      staleTime: Number.POSITIVE_INFINITY,
    })
    await settle()
    calls.length = 0

    refetchForPullToRefresh(client)
    await settle()

    expect(calls).toEqual([])
    release()
    client.unmount()
  })
})
