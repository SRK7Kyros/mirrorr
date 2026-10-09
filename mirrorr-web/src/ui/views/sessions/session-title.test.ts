import { describe, expect, it } from "vitest"
import type { NameMaps } from "@/api"
import type { Session } from "@/api/schemas"
import { sessionTitle } from "./session-title"

function names(profiles: Record<number, string> = {}): NameMaps {
  return {
    engines: new Map(),
    resolvers: new Map(),
    profiles: new Map(Object.entries(profiles).map(([id, name]) => [Number(id), name])),
  }
}

function session(overrides: Partial<Session> = {}): Session {
  return { id: 7, engine_id: 1, resolver_id: 1, status: "active", ...overrides } as Session
}

describe("sessionTitle", () => {
  it("prefers the autorun that spawned it", () => {
    expect(sessionTitle(session({ autorun_name: "Morning news", profile_name: "news" }), names())).toBe(
      "Morning news",
    )
  })

  it("falls back to the profile name", () => {
    expect(sessionTitle(session({ profile_name: "news" }), names())).toBe("news")
  })

  it("resolves the profile from the name map", () => {
    expect(sessionTitle(session({ profile_id: 3 }), names({ 3: "sports" }))).toBe("sports")
  })

  it("falls back to the id", () => {
    expect(sessionTitle(session(), names())).toBe("#7")
  })
})
