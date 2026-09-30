/**
 * D1's submission rules (spec L401): profile prefill is editable, an unedited
 * profile selection submits `{profile_id, recording}` only, and any field edit
 * switches to the full explicit form. Also covers the engine-driven retry
 * defaults and the resolver-config validation used for inline 422s.
 */
import { describe, expect, it } from "vitest"
import {
  applyEngine,
  applyProfile,
  applyResolver,
  applyRetryMode,
  buildSessionRequest,
  createEmptySessionForm,
  markSessionFormDirty,
  retryModeOptions,
  sessionFormErrors,
} from "@/lib/new-session-form"
import type { Engine, Profile, Resolver } from "@/lib/schemas/plugins"

const RECORDING_ENGINE: Engine = {
  id: 1,
  name: "yt_dlp_piped",
  capabilities: { can_record: true },
  retry_modes_schema: {
    none: { default_params: {} },
    count: {
      schema: { type: "object", properties: { count: { type: "integer" } } },
      default_params: { count: 3, delay: 5 },
    },
  },
}

const MUTE_ENGINE: Engine = {
  id: 2,
  name: "still-images",
  capabilities: { can_record: false },
  retry_modes_schema: { none: { default_params: {} }, count: { default_params: { count: 3, delay: 5 } } },
}

const STATIC_RESOLVER: Resolver = {
  id: 1,
  name: "static",
  config_schema: {
    type: "object",
    properties: { url: { type: "string" }, headers: { type: "object" } },
    required: ["url"],
  },
}

const PROFILE: Profile = {
  id: 9,
  name: "p2",
  default_engine_id: 1,
  resolver_id: 1,
  resolver_config: { url: "https://example.com/x.m3u8" },
  retry_mode: "none",
  retry_config: {},
}

describe("buildSessionRequest", () => {
  it("submits only {profile_id, recording} for an unedited profile selection", () => {
    const state = applyProfile(createEmptySessionForm(), PROFILE)

    expect(buildSessionRequest(state)).toEqual({ profile_id: 9, recording: false })
  })

  it("submits the full explicit form after a single field edit", () => {
    const prefilled = applyProfile(createEmptySessionForm(), PROFILE)
    const edited = markSessionFormDirty(applyEngine(prefilled, MUTE_ENGINE), "engine")

    expect(buildSessionRequest(edited)).toEqual({
      engine_id: 2,
      resolver_id: 1,
      resolver_config: { url: "https://example.com/x.m3u8" },
      retry_mode: "none",
      retry_config: {},
      recording: false,
    })
  })

  it("treats the recording toggle as a field edit (all-or-nothing submission)", () => {
    const prefilled = applyProfile(createEmptySessionForm(), PROFILE)
    const edited = markSessionFormDirty({ ...prefilled, recording: true }, "recording")

    expect(buildSessionRequest(edited)).toEqual({
      engine_id: 1,
      resolver_id: 1,
      resolver_config: { url: "https://example.com/x.m3u8" },
      retry_mode: "none",
      retry_config: {},
      recording: true,
    })
  })
})

describe("form transitions", () => {
  it("clears recording when the selected engine cannot record", () => {
    const prefilled = applyProfile(createEmptySessionForm(), PROFILE)
    const state = applyEngine({ ...prefilled, recording: true }, MUTE_ENGINE)

    expect(state.recording).toBe(false)
    expect(state.engineId).toBe(2)
  })

  it("prefills resolver and retry defaults on selection changes", () => {
    const withResolver = applyResolver(createEmptySessionForm(), STATIC_RESOLVER)
    expect(withResolver.resolverConfig).toEqual({})

    const counted = applyRetryMode(withResolver, RECORDING_ENGINE, "count")
    expect(counted.retryMode).toBe("count")
    expect(counted.retryConfig).toEqual({ count: 3, delay: 5 })
    expect(retryModeOptions(RECORDING_ENGINE)).toEqual(["none", "count"])
  })
})

describe("sessionFormErrors", () => {
  it("requires an engine, a resolver and the resolver's required fields", () => {
    const empty = sessionFormErrors(createEmptySessionForm(), null)
    expect(empty.engine_id).toBeDefined()
    expect(empty.resolver_id).toBeDefined()

    const filled = sessionFormErrors(
      applyResolver(createEmptySessionForm(), STATIC_RESOLVER),
      STATIC_RESOLVER,
    )
    expect(filled["resolver_config.url"]).toBe("Required")

    const withUrl = applyResolver(createEmptySessionForm(), STATIC_RESOLVER)
    const errors = sessionFormErrors(
      { ...withUrl, resolverConfig: { url: "https://example.com/x.m3u8" } },
      STATIC_RESOLVER,
    )
    expect(errors["resolver_config.url"]).toBeUndefined()
  })
})
