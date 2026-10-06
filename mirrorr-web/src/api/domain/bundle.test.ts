import { describe, expect, it } from "vitest"
import type { ImportItem } from "@/api/endpoints"
import {
  buildApplyBody,
  countBundleItems,
  isSupportedVersion,
  issueKind,
  issueOriginHash,
  issuePluginType,
  itemBadge,
  suggestedRename,
} from "./bundle"

function item(overrides: Partial<ImportItem> & Pick<ImportItem, "name">): ImportItem {
  return {
    kind: "profile",
    status: "valid",
    issues: [],
    entry: {},
    ...overrides,
  } as ImportItem
}

const BUNDLE = {
  version: 1,
  exported_at: "2026-09-30T00:00:00Z",
  profiles: [
    { name: "harbour-cam", retry_mode: "none", engine: { name: "yt_dlp_piped" } },
    { name: "lofi_radio_overnight", retry_mode: "none", engine: { name: "static" } },
  ],
  autoruns: [
    { name: "Speedcubing finals", snake_case_name: "speedcubing_finals", profile: { name: "speedcubing" } },
  ],
}

describe("bundle guards", () => {
  it("accepts only version 1 bundles", () => {
    expect(isSupportedVersion(BUNDLE)).toBe(true)
    expect(isSupportedVersion({ version: 2 })).toBe(false)
    expect(isSupportedVersion(null)).toBe(false)
    expect(isSupportedVersion("nope")).toBe(false)
  })

  it("counts profiles + autoruns (the MAX_BUNDLE_ITEMS guard)", () => {
    expect(countBundleItems(BUNDLE)).toBe(3)
    expect(countBundleItems({ version: 1 })).toBe(0)
    expect(countBundleItems(null)).toBe(0)
  })
})

describe("issue helpers", () => {
  it("classifies known issue types and falls back to other", () => {
    expect(issueKind({ type: "not_installed" })).toBe("not_installed")
    expect(issueKind({ type: "profile_missing" })).toBe("profile_missing")
    expect(issueKind({ type: "something_new" })).toBe("other")
  })

  it("reads an origin hash from any of the server's hash fields", () => {
    expect(issueOriginHash({ origin_hash: "6e57a1c4" })).toBe("6e57a1c4")
    expect(issueOriginHash({ hash: "f1c2b8e0" })).toBe("f1c2b8e0")
    expect(issueOriginHash({ content_hash: "abc" })).toBe("abc")
    expect(issueOriginHash({ origin_hash: "" })).toBeNull()
    expect(issueOriginHash({})).toBeNull()
  })

  it("defaults an untyped plugin issue to engine", () => {
    expect(issuePluginType({})).toBe("engine")
    expect(issuePluginType({ plugin_type: "resolver" })).toBe("resolver")
  })

  it("previews the server's suggested rename", () => {
    const conflict = item({
      name: "arena",
      issues: [{ type: "name_conflict", suggested: "arena_2" }] as ImportItem["issues"],
    })
    expect(suggestedRename(conflict)).toBe("arena_2")
    expect(suggestedRename(item({ name: "clean" }))).toBeNull()
  })

  it("maps items to their review badge", () => {
    expect(itemBadge(item({ name: "a" }))).toBe("ready")
    expect(itemBadge(item({ name: "b", status: "skip" }))).toBe("skip")
    expect(
      itemBadge(item({ name: "c", issues: [{ type: "name_conflict" }] as ImportItem["issues"] })),
    ).toBe("conflict")
    expect(
      itemBadge(item({ name: "d", issues: [{ type: "not_installed" }] as ImportItem["issues"] })),
    ).toBe("needs-mapping")
  })
})

describe("buildApplyBody", () => {
  it("sends the edited bundle and an empty map when nothing changes", () => {
    const items = [item({ name: "harbour-cam" }), item({ name: "Speedcubing finals", kind: "autorun" })]
    const body = buildApplyBody(BUNDLE, items, {})
    expect(body.plugin_map).toEqual({})
    expect(body.removed_profiles).toBeUndefined()
    expect(body.removed_autoruns).toBeUndefined()
    // Deep clone: the original bundle object must not be mutated by apply.
    expect(body.bundle).not.toBe(BUNDLE)
  })

  it("maps only excluded items into removed_* and never for included ones", () => {
    const items = [item({ name: "harbour-cam" }), item({ name: "lofi_radio_overnight" })]
    const body = buildApplyBody(BUNDLE, items, {
      lofi_radio_overnight: { included: false },
    })
    expect(body.removed_profiles).toEqual(["lofi_radio_overnight"])
    expect(body.removed_autoruns).toBeUndefined()
  })

  it("records plugin_map only when a hash issue carries a chosen plugin", () => {
    const items = [
      item({
        name: "harbour-cam",
        issues: [{ type: "not_installed", origin_hash: "6e57a1c4" }] as ImportItem["issues"],
      }),
    ]
    const body = buildApplyBody(BUNDLE, items, {
      "harbour-cam": {
        included: true,
        plugin: { type: "engine", id: 7 },
        pluginHash: "6e57a1c4",
      },
    })
    expect(body.plugin_map).toEqual({ "6e57a1c4": { type: "engine", id: 7 } })
  })

  it("binds a profile_missing item to a named installed profile", () => {
    const items = [item({ name: "Speedcubing finals", kind: "autorun" })]
    const body = buildApplyBody(BUNDLE, items, {
      "Speedcubing finals": { included: true, profile: { mode: "bind", profileName: "speedcubing_2026" } },
    })
    const autoruns = (body.bundle as { autoruns: { name: string; profile?: { name: string } }[] }).autoruns
    expect(autoruns[0].profile).toEqual({ name: "speedcubing_2026" })
  })

  it("strips inline engine fields when the profile engine is chosen", () => {
    const items = [item({ name: "harbour-cam" })]
    const body = buildApplyBody(BUNDLE, items, {
      "harbour-cam": { included: true, engine: { mode: "profile" } },
    })
    const profile = (body.bundle as { profiles: Record<string, unknown>[] }).profiles[0]
    expect(profile.engine).toBeUndefined()
    expect(profile.retry_mode).toBeUndefined()
  })
})
