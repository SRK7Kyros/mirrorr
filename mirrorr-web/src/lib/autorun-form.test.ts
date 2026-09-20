import { describe, expect, it } from "vitest"
import {
  AUTORUN_LIVE_END_WARNING,
  AUTORUN_LIVE_LOCK_MESSAGE,
  AUTORUN_SLUG_INVALID_MESSAGE,
  AUTORUN_SLUG_PATTERN,
  AUTORUN_SLUG_REQUIRED_MESSAGE,
  applyAutorunProfile,
  autorunFormErrors,
  autorunFormFromAutorun,
  autorunSlugError,
  autorunTimeWarning,
  buildAutorunCreateBody,
  buildAutorunSlug,
  buildAutorunUpdateBody,
  createEmptyAutorunForm,
  isAutorunLiveStatus,
  markAutorunFormDirty,
  withAutorunEnd,
  withAutorunName,
  withAutorunSlug,
} from "@/lib/autorun-form"
import type { Autorun } from "@/lib/schemas/autoruns"
import type { Profile, Resolver } from "@/lib/schemas/plugins"

const RESOLVER: Resolver = {
  id: 1,
  name: "static",
  config_schema: {
    type: "object",
    properties: { url: { type: "string", title: "Url" } },
    required: ["url"],
  },
}

const PROFILE: Profile = {
  id: 9,
  name: "p2",
  default_engine_id: 1,
  resolver_id: 1,
  resolver_config: { url: "https://example.com/a.m3u8" },
  retry_mode: "none",
  retry_config: {},
}

const AUTHORUN: Autorun = {
  id: 5,
  user_friendly_name: "Morning show",
  snake_case_name: "morning_show",
  engine_id: 1,
  resolver_id: 1,
  resolver_config: { url: "https://example.com/a.m3u8" },
  retry_mode: "none",
  retry_config: {},
  status: "scheduled",
  start_time: "2026-07-15T12:00:00",
  end_time: "2026-07-15T13:00:00",
  recording: true,
}

const NAIVE_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/

function scheduledForm() {
  return markAutorunFormDirty(
    {
      ...createEmptyAutorunForm(),
      userFriendlyName: "Morning show",
      snakeCaseName: "morning_show",
      engineId: 1,
      resolverId: 1,
      resolverConfig: { url: "https://example.com/a.m3u8" },
      startLocal: "2026-07-15T08:00",
      endLocal: "2026-07-15T09:00",
    },
    "start_time",
    "end_time",
  )
}

describe("slug rules", () => {
  it("uses the spec regex", () => {
    expect(AUTORUN_SLUG_PATTERN.source).toBe("^[a-zA-Z0-9_-]+$")
  })

  it("auto-slugs the name into [a-z0-9_-]", () => {
    expect(buildAutorunSlug("Morning Show 2026!")).toBe("morning_show_2026")
    expect(buildAutorunSlug("  Café & News  ")).toBe("caf_news")
    expect(buildAutorunSlug("already_snake")).toBe("already_snake")
  })

  it("validates live with required + pattern messages", () => {
    expect(autorunSlugError("morning_show-1")).toBeUndefined()
    expect(autorunSlugError("")).toBe(AUTORUN_SLUG_REQUIRED_MESSAGE)
    expect(autorunSlugError("bad slug")).toBe(AUTORUN_SLUG_INVALID_MESSAGE)
    expect(autorunSlugError("naïve")).toBe(AUTORUN_SLUG_INVALID_MESSAGE)
  })

  it("keeps the slug in sync until a manual override", () => {
    let state = createEmptyAutorunForm()
    state = withAutorunName(state, "Morning Show")
    expect(state.snakeCaseName).toBe("morning_show")
    expect(state.dirty.has("snake_case_name")).toBe(true)

    state = withAutorunSlug(state, "custom_slug")
    state = withAutorunName(state, "Evening Show")
    expect(state.snakeCaseName).toBe("custom_slug")
  })
})

describe("create bodies", () => {
  it("sends the short profile body while no config field is dirty", () => {
    let state = createEmptyAutorunForm()
    state = applyAutorunProfile(state, PROFILE)
    state = withAutorunName(state, "Morning show")
    state = { ...state, startLocal: "2026-07-15T08:00", endLocal: "2026-07-15T09:00" }
    state = markAutorunFormDirty(state, "start_time", "end_time")

    const body = buildAutorunCreateBody(state)
    expect(body.profile_id).toBe(9)
    expect(body.engine_id).toBeUndefined()
    expect(body.snake_case_name).toBe("morning_show")
  })

  it("switches to the full explicit body on any config edit", () => {
    let state = createEmptyAutorunForm()
    state = applyAutorunProfile(state, PROFILE)
    state = withAutorunName(state, "Morning show")
    state = { ...state, startLocal: "2026-07-15T08:00", endLocal: "2026-07-15T09:00" }
    state = markAutorunFormDirty(state, "engine")

    const body = buildAutorunCreateBody(state)
    expect(body.profile_id).toBeUndefined()
    expect(body.engine_id).toBe(1)
    expect(body.resolver_id).toBe(1)
    expect(body.resolver_config).toEqual(PROFILE.resolver_config)
  })

  it("converts picker values to naive UTC without Z or an offset", () => {
    const body = buildAutorunCreateBody(scheduledForm())
    expect(body.start_time).toMatch(NAIVE_UTC)
    expect(body.end_time).toMatch(NAIVE_UTC)
    expect(body.start_time.endsWith("Z")).toBe(false)
  })

  it("rejects tz-suffixed picker values instead of silently shifting them", () => {
    const state = { ...scheduledForm(), startLocal: "2026-07-15T08:00:00Z" }
    expect(() => buildAutorunCreateBody(state)).toThrow()
  })
})

describe("update bodies", () => {
  it("sends only dirty fields", () => {
    const original = autorunFormFromAutorun(AUTHORUN)
    let state = withAutorunName(original, "Morning show 2")
    state = withAutorunEnd(state, "2026-07-15T10:00")

    // Edit mode preloads the existing slug as a manual override: renaming
    // must not silently re-slug a persisted name.
    const body = buildAutorunUpdateBody(state, { locked: false })
    expect(Object.keys(body).sort()).toEqual(["end_time", "user_friendly_name"])
    expect(body.start_time).toBeUndefined()
    expect(body.engine_id).toBeUndefined()
    expect(body.end_time).toMatch(NAIVE_UTC)
  })

  it("drops the frozen fields entirely while live", () => {
    let state = withAutorunName(autorunFormFromAutorun(AUTHORUN), "Renamed")
    state = markAutorunFormDirty(state, "start_time", "engine", "resolver_config", "retry_mode")
    state = withAutorunEnd(state, "2026-07-15T10:00")

    const body = buildAutorunUpdateBody(state, { locked: true })
    expect(body.user_friendly_name).toBe("Renamed")
    expect(body.end_time).toMatch(NAIVE_UTC)
    expect(body.start_time).toBeUndefined()
    expect(body.engine_id).toBeUndefined()
    expect(body.resolver_config).toBeUndefined()
    expect(body.retry_mode).toBeUndefined()
  })
})

describe("validation", () => {
  const base = { resolver: RESOLVER, mode: "create" as const, now: new Date("2026-07-15T12:00:00Z"), timeZone: "UTC" }

  it("requires the name and the slug characters", () => {
    const state = { ...scheduledForm(), userFriendlyName: "", snakeCaseName: "bad slug" }
    const errors = autorunFormErrors(state, base)
    expect(errors.user_friendly_name).toBeDefined()
    expect(errors.snake_case_name).toBe(AUTORUN_SLUG_INVALID_MESSAGE)
  })

  it("rejects end before start and accepts a past start with a warning", () => {
    const invalid = { ...scheduledForm(), startLocal: "2026-07-15T10:00", endLocal: "2026-07-15T09:00" }
    expect(autorunFormErrors(invalid, base).end_time).toBeDefined()

    const past = { ...scheduledForm(), startLocal: "2026-07-15T06:00", endLocal: "2026-07-15T07:00" }
    expect(autorunFormErrors(past, base).end_time).toBeUndefined()
    expect(autorunTimeWarning(past, base.now, base.timeZone)).toBeDefined()
  })

  it("skips config errors while live-locked", () => {
    const state = { ...scheduledForm(), engineId: null, resolverId: null }
    const errors = autorunFormErrors(state, { ...base, mode: "edit", locked: true })
    expect(errors.engine_id).toBeUndefined()
    expect(errors.resolver_id).toBeUndefined()
  })

  it("carries the exact live-lock and end-warning copy", () => {
    expect(AUTORUN_LIVE_LOCK_MESSAGE).toBe(
      "This autorun is running — only name and times can change; setting an end time in the past stops the current run",
    )
    expect(AUTORUN_LIVE_END_WARNING).toBe("Setting an end time in the past stops the current run")
    expect(isAutorunLiveStatus("recording")).toBe(true)
    expect(isAutorunLiveStatus("scheduled")).toBe(false)
  })
})
