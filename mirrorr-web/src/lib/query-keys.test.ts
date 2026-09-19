import { describe, expect, it } from "vitest"
import { QUERY_STALE_TIMES_MS, normalizeListFilters, queryKeys } from "@/lib/query-keys"

/**
 * Query-key table + staleTimes from `docs/web-frontend-spec.md` L120-L137 and
 * the "filter/search changes reset the query key" rule at L138.
 */
describe("query keys", () => {
  it("matches the spec key shapes", () => {
    expect(queryKeys.authMe()).toEqual(["auth", "me"])
    expect(queryKeys.session(7)).toEqual(["session", 7])
    expect(queryKeys.autorun(4)).toEqual(["autorun", 4])
    expect(queryKeys.profile(3)).toEqual(["profile", 3])
    expect(queryKeys.engines()).toEqual(["engines"])
    expect(queryKeys.resolvers()).toEqual(["resolvers"])
    expect(queryKeys.notifications()).toEqual(["notifications"])
    expect(queryKeys.users()).toEqual(["users"])
    expect(queryKeys.clients()).toEqual(["clients"])
    expect(queryKeys.sessions()).toEqual(["sessions", {}])
    expect(queryKeys.autoruns()).toEqual(["autoruns", {}])
    expect(queryKeys.recordings()).toEqual(["recordings", {}])
    expect(queryKeys.profiles()).toEqual(["profiles", {}])
  })

  it("carries the normalized filter under every list key", () => {
    expect(queryKeys.sessions({ status: "live" })).toEqual(["sessions", { status: "live" }])
    expect(queryKeys.autoruns({ search: "nightly" })).toEqual(["autoruns", { search: "nightly" }])
    expect(queryKeys.recordings({ limit: 20 })).toEqual(["recordings", { limit: 20 }])
    expect(queryKeys.profiles({ status: "active" })).toEqual(["profiles", { status: "active" }])
  })
})

describe("normalizeListFilters", () => {
  it("drops undefined, null and empty-string filters", () => {
    expect(normalizeListFilters({ search: "", status: undefined, owner: null })).toEqual({})
    expect(normalizeListFilters()).toEqual({})
  })

  it("keeps false and zero (meaningful filter values)", () => {
    expect(normalizeListFilters({ recording: false, offset: 0 })).toEqual({ recording: false, offset: 0 })
  })

  it("is order-insensitive so equal filters hash to the same key", () => {
    expect(queryKeys.sessions({ status: "live", search: "a" })).toEqual(
      queryKeys.sessions({ search: "a", status: "live" }),
    )
  })
})

describe("filter changes reset the query key (L138)", () => {
  it("yields a different key for a different filter value", () => {
    expect(queryKeys.sessions({ status: "live" })).not.toEqual(queryKeys.sessions({ status: "failed" }))
    expect(queryKeys.sessions({ search: "news" })).not.toEqual(queryKeys.sessions({ search: "sport" }))
  })

  it("re-yields an equal key for the same filter", () => {
    expect(queryKeys.sessions({ search: "news", status: "live" })).toEqual(
      queryKeys.sessions({ search: "news", status: "live" }),
    )
  })

  it("treats an all/blank filter as the unfiltered key", () => {
    expect(queryKeys.sessions({ search: "", status: "" })).toEqual(queryKeys.sessions())
  })
})

describe("QUERY_STALE_TIMES_MS", () => {
  it("encodes the spec staleTime column exactly", () => {
    expect(QUERY_STALE_TIMES_MS).toEqual({
      authMe: 60_000,
      sessions: 0,
      session: 0,
      autoruns: 0,
      autorun: 0,
      recordings: 0,
      profiles: 0,
      profile: 30_000,
      engines: 300_000,
      resolvers: 300_000,
      notifications: 30_000,
      users: 30_000,
      clients: 30_000,
    })
  })
})
