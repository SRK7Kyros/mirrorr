/**
 * Todo 24 acceptance (spec L489-L501): the route→tab mapping and the 56px FAB
 * flag/omit rules are centralized here and pinned for every route in the
 * router tree. The tab bar slots are the spec's five (Sessions, Autoruns,
 * Recordings, Profiles, More); the FAB exists only where a view has a primary
 * action (V3/V5/V8/V12/V13) and is omitted on read-only views (Plugins) and
 * where the action lives in-page (details, wizard footers, account save).
 */
import { describe, expect, it } from "vitest"
import {
  COMPACT_TABS,
  compactFabForPath,
  compactTabForPath,
  isNestedRoute,
  type CompactFabRule,
} from "@/lib/compact-nav"

describe("COMPACT_TABS", () => {
  it("holds the five spec slots in spec order with the sidebar labels", () => {
    expect(COMPACT_TABS.map((tab) => tab.id)).toEqual([
      "sessions",
      "autoruns",
      "recordings",
      "profiles",
      "more",
    ])
    expect(COMPACT_TABS.map((tab) => tab.label)).toEqual([
      "Sessions",
      "Autoruns",
      "Recordings",
      "Profiles",
      "More",
    ])
  })

  it("routes the four destination slots to the sidebar destinations and leaves More sheet-owned", () => {
    expect(COMPACT_TABS.map((tab) => tab.to)).toEqual([
      "/sessions",
      "/autoruns",
      "/recordings",
      "/profiles",
      null,
    ])
  })
})

describe("compactTabForPath", () => {
  const cases: readonly (readonly [string, string])[] = [
    ["/", "more"],
    ["/sessions", "sessions"],
    ["/sessions/5", "sessions"],
    ["/autoruns", "autoruns"],
    ["/autoruns/9", "autoruns"],
    ["/recordings", "recordings"],
    ["/profiles", "profiles"],
    ["/plugins", "more"],
    ["/import-export", "more"],
    ["/settings", "more"],
    ["/settings/users", "more"],
    ["/settings/clients", "more"],
    ["/dev/data-probe", "more"],
    ["/does-not-exist", "more"],
  ]

  it.each(cases)("maps %s to the %s tab", (pathname, expected) => {
    expect(compactTabForPath(pathname)).toBe(expected)
  })

  it("does not treat a shared prefix as a match (/sessions-archive)", () => {
    expect(compactTabForPath("/sessions-archive")).toBe("more")
  })
})

describe("isNestedRoute", () => {
  const cases: readonly (readonly [string, boolean])[] = [
    ["/", false],
    ["/sessions", false],
    ["/sessions/5", true],
    ["/autoruns/9", true],
    ["/recordings", false],
    ["/profiles", false],
    ["/plugins", false],
    ["/import-export", false],
    ["/settings", false],
    ["/settings/users", true],
    ["/settings/clients", true],
    ["/dev/data-probe", true],
  ]

  it.each(cases)("classifies %s as nested=%s", (pathname, expected) => {
    expect(isNestedRoute(pathname)).toBe(expected)
  })
})

describe("compactFabForPath", () => {  it("returns the create action on each list view that owns one", () => {
    expect(compactFabForPath("/sessions")).toEqual({
      kind: "action",
      id: "new-session",
      label: "New session",
    })
    expect(compactFabForPath("/autoruns")).toEqual({
      kind: "action",
      id: "new-autorun",
      label: "New autorun",
    })
    expect(compactFabForPath("/profiles")).toEqual({
      kind: "action",
      id: "new-profile",
      label: "New profile",
    })
    expect(compactFabForPath("/settings/users")).toEqual({
      kind: "action",
      id: "new-user",
      label: "New user",
    })
    expect(compactFabForPath("/settings/clients")).toEqual({
      kind: "action",
      id: "new-key",
      label: "New key",
    })
  })

  it("omits the FAB on the read-only plugins view", () => {
    expect(compactFabForPath("/plugins")).toEqual({ kind: "omit", reason: "read-only" })
  })

  it("omits the FAB where the view's action lives in-page", () => {
    const inPagePaths = [
      "/",
      "/recordings",
      "/sessions/5",
      "/autoruns/9",
      "/settings",
      "/import-export",
      "/dev/data-probe",
      "/does-not-exist",
    ]
    for (const pathname of inPagePaths) {
      expect(compactFabForPath(pathname)).toEqual({ kind: "omit", reason: "in-page" })
    }
  })

  it("returns a rule for every path (never null) so omission is always explicit", () => {
    const paths = [
      "/",
      "/sessions",
      "/sessions/5",
      "/autoruns",
      "/autoruns/9",
      "/recordings",
      "/profiles",
      "/plugins",
      "/import-export",
      "/settings",
      "/settings/users",
      "/settings/clients",
      "/dev/data-probe",
      "/does-not-exist",
    ]
    for (const pathname of paths) {
      const rule: CompactFabRule = compactFabForPath(pathname)
      expect(rule.kind === "action" || rule.kind === "omit").toBe(true)
    }
  })

  it("keeps every action label non-empty and unique", () => {
    const labels = ["/sessions", "/autoruns", "/profiles", "/settings/users", "/settings/clients"].map(
      (pathname) => {
        const rule = compactFabForPath(pathname)
        if (rule.kind !== "action") throw new Error(`${pathname} should own a FAB action`)
        return rule.label
      },
    )
    expect(labels.every((label) => label.length > 0)).toBe(true)
    expect(new Set(labels).size).toBe(labels.length)
  })
})
