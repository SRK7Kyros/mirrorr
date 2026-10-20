import { describe, expect, it } from "vitest"
import {
  API_CLIENT_POLL_MS,
  LIST_BACKSTOP_MS,
  WS_FALLBACK_POLL_MS,
  listRefetchInterval,
} from "./polling"
import {
  buildNameMap,
  getNextPageParam,
  mergedSortedByIdDesc,
  queryKeys,
  resolveEntityName,
  sortByIdDesc,
  staleTimes,
} from "./query-keys"

describe("query key table", () => {
  it("emits the exact contract keys", () => {
    expect(queryKeys.authMe).toEqual(["auth", "me"])
    expect(queryKeys.sessions({ status: "active" })).toEqual(["sessions", { status: "active" }])
    expect(queryKeys.session(7)).toEqual(["session", "7"])
    expect(queryKeys.autoruns()).toEqual(["autoruns", {}])
    expect(queryKeys.autorun(3)).toEqual(["autorun", "3"])
    expect(queryKeys.recordings()).toEqual(["recordings", {}])
    expect(queryKeys.profiles()).toEqual(["profiles", {}])
    expect(queryKeys.profile(9)).toEqual(["profile", "9"])
    expect(queryKeys.engines).toEqual(["engines"])
    expect(queryKeys.resolvers).toEqual(["resolvers"])
    expect(queryKeys.notifications).toEqual(["notifications"])
    expect(queryKeys.users).toEqual(["users"])
    expect(queryKeys.clients).toEqual(["clients"])
  })

  it("normalises numeric and string detail ids to one key", () => {
    expect(queryKeys.session("7")).toEqual(queryKeys.session(7))
    expect(queryKeys.autorun("3")).toEqual(queryKeys.autorun(3))
    expect(queryKeys.profile("9")).toEqual(queryKeys.profile(9))
    expect(queryKeys.source("2")).toEqual(queryKeys.source(2))
    expect(queryKeys.adminResourceAccess("session", "4")).toEqual(
      queryKeys.adminResourceAccess("session", 4),
    )
  })

  it("pins the staleTime table", () => {
    expect(staleTimes.authMe).toBe(60_000)
    expect(staleTimes.list).toBe(0)
    expect(staleTimes.detail).toBe(0)
    expect(staleTimes.profileDetail).toBe(30_000)
    expect(staleTimes.lookup).toBe(300_000)
    expect(staleTimes.notifications).toBe(30_000)
    expect(staleTimes.users).toBe(30_000)
    expect(staleTimes.clients).toBe(30_000)
  })
})

describe("pagination", () => {
  it("continues the cursor only while has_more", () => {
    expect(getNextPageParam({ items: [], has_more: true, next_cursor: 42 })).toBe(42)
    expect(getNextPageParam({ items: [], has_more: false, next_cursor: 9 })).toBeUndefined()
    expect(getNextPageParam({ items: [], has_more: true, next_cursor: null })).toBeUndefined()
    expect(getNextPageParam(undefined)).toBeUndefined()
  })

  it("client-sorts merged pages id-desc (server order not guaranteed)", () => {
    const pages = [
      { items: [{ id: 5 }, { id: 3 }], has_more: true, next_cursor: 3 },
      { items: [{ id: 9 }, { id: 1 }], has_more: false, next_cursor: null },
    ]
    expect(mergedSortedByIdDesc(pages).map((item) => item.id)).toEqual([9, 5, 3, 1])
    expect(sortByIdDesc([{ id: 1 }, { id: 2 }]).map((item) => item.id)).toEqual([2, 1])
  })
})

describe("polling policy", () => {
  it("applies api-client 10s > ws-fallback 15s > backstop 30s", () => {
    expect(API_CLIENT_POLL_MS).toBe(10_000)
    expect(WS_FALLBACK_POLL_MS).toBe(15_000)
    expect(LIST_BACKSTOP_MS).toBe(30_000)
    expect(listRefetchInterval({ isApiClient: true, wsPollingFallback: false })).toBe(
      API_CLIENT_POLL_MS,
    )
    expect(listRefetchInterval({ isApiClient: false, wsPollingFallback: true })).toBe(
      WS_FALLBACK_POLL_MS,
    )
    expect(listRefetchInterval({ isApiClient: true, wsPollingFallback: true })).toBe(
      API_CLIENT_POLL_MS,
    )
    expect(listRefetchInterval({ isApiClient: false, wsPollingFallback: false })).toBe(
      LIST_BACKSTOP_MS,
    )
  })
})

describe("name memo-map", () => {
  it("prefers direct names, falls back to the map, then #id", () => {
    const names = buildNameMap([
      { id: 1, name: "yt-dlp_piped" },
      { id: 2, name: "static" },
    ])
    expect(resolveEntityName("direct", names, 1)).toBe("direct")
    expect(resolveEntityName(null, names, 2)).toBe("static")
    expect(resolveEntityName(undefined, names, 99)).toBe("#99")
    expect(resolveEntityName("", names, 99)).toBe("#99")
    expect(resolveEntityName(null, names, null)).toBe("—")
  })
})
