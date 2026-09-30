/**
 * V8 editor form state (spec L331): engine/resolver pickers, dynamic configs
 * from `config_schema` and `retry_modes_schema[mode]`, and the submitted body
 * (client contract §3).
 */
import { describe, expect, it } from "vitest"
import {
  applyProfileEngine,
  applyProfileResolver,
  applyProfileRetryMode,
  buildProfileBody,
  createEmptyProfileForm,
  profileFormErrors,
  profileFormFromProfile,
} from "@/lib/profile-form"
import type { Engine, Profile, Resolver } from "@/lib/schemas/plugins"

const ENGINE: Engine = {
  id: 1,
  name: "yt_dlp_piped",
  retry_modes_schema: {
    none: { default_params: {} },
    count: { default_params: { count: 3, delay: 5 } },
  },
}

const RESOLVER: Resolver = {
  id: 2,
  name: "static",
  config_schema: {
    type: "object",
    properties: {
      url: { type: "string" },
      headers: { type: "object", properties: { referer: { type: "string", default: "x" } } },
    },
    required: ["url"],
  },
}

const PROFILE: Profile = {
  id: 9,
  name: "p2",
  default_engine_id: 1,
  resolver_id: 2,
  resolver_config: { url: "https://example.com/original.m3u8" },
  retry_mode: "count",
  retry_config: { count: 2, delay: 9 },
}

describe("createEmptyProfileForm", () => {
  it("starts blank with the none retry mode", () => {
    expect(createEmptyProfileForm()).toEqual({
      name: "",
      engineId: null,
      resolverId: null,
      resolverConfig: {},
      retryMode: "none",
      retryConfig: {},
    })
  })
})

describe("profileFormFromProfile", () => {
  it("prefills every field from the profile, copying its configs", () => {
    const form = profileFormFromProfile(PROFILE)
    expect(form).toEqual({
      name: "p2",
      engineId: 1,
      resolverId: 2,
      resolverConfig: { url: "https://example.com/original.m3u8" },
      retryMode: "count",
      retryConfig: { count: 2, delay: 9 },
    })
    expect(form.resolverConfig).not.toBe(PROFILE.resolver_config)
  })

  it("falls back to none for a null retry mode", () => {
    expect(profileFormFromProfile({ ...PROFILE, retry_mode: null }).retryMode).toBe("none")
  })
})

describe("field edits", () => {
  it("keeps the current retry mode when the engine declares it and prefills its defaults", () => {
    const state = applyProfileEngine({ ...createEmptyProfileForm(), retryMode: "count" }, ENGINE)
    expect(state.engineId).toBe(1)
    expect(state.retryMode).toBe("count")
    expect(state.retryConfig).toEqual({ count: 3, delay: 5 })
  })

  it("falls back to none when the new engine does not declare the mode", () => {
    const state = applyProfileEngine({ ...createEmptyProfileForm(), retryMode: "exit_code" }, ENGINE)
    expect(state.retryMode).toBe("none")
    expect(state.retryConfig).toEqual({})
  })

  it("prefills resolver schema defaults on resolver change", () => {
    const state = applyProfileResolver(createEmptyProfileForm(), RESOLVER)
    expect(state.resolverId).toBe(2)
    expect(state.resolverConfig).toEqual({ headers: { referer: "x" } })
  })

  it("prefills retry mode defaults on mode change", () => {
    const state = applyProfileRetryMode(createEmptyProfileForm(), ENGINE, "count")
    expect(state.retryMode).toBe("count")
    expect(state.retryConfig).toEqual({ count: 3, delay: 5 })
  })
})

describe("buildProfileBody", () => {
  it("returns null until name, engine and resolver are chosen", () => {
    expect(buildProfileBody(createEmptyProfileForm())).toBeNull()
    expect(buildProfileBody({ ...createEmptyProfileForm(), name: "p" })).toBeNull()
    expect(
      buildProfileBody({ ...createEmptyProfileForm(), name: "p", engineId: 1 }),
    ).toBeNull()
  })

  it("builds the full body once the form is complete", () => {
    expect(
      buildProfileBody({
        name: "  p3  ",
        engineId: 1,
        resolverId: 2,
        resolverConfig: { url: "https://example.com/live.m3u8" },
        retryMode: "count",
        retryConfig: { count: 3 },
      }),
    ).toEqual({
      name: "p3",
      default_engine_id: 1,
      resolver_id: 2,
      resolver_config: { url: "https://example.com/live.m3u8" },
      retry_mode: "count",
      retry_config: { count: 3 },
    })
  })
})

describe("profileFormErrors", () => {
  it("marks name, engine and resolver when missing", () => {
    const errors = profileFormErrors(createEmptyProfileForm(), RESOLVER)
    expect(errors.name).toBe("Enter a name")
    expect(errors.default_engine_id).toBe("Select an engine")
    expect(errors.resolver_id).toBe("Select a resolver")
  })

  it("maps missing required config keys to dotted paths", () => {
    const state = { ...createEmptyProfileForm(), name: "p", engineId: 1, resolverId: 2 }
    expect(profileFormErrors(state, RESOLVER)).toEqual({ "resolver_config.url": "Required" })
  })

  it("is clean for a complete form", () => {
    const state = {
      ...createEmptyProfileForm(),
      name: "p",
      engineId: 1,
      resolverId: 2,
      resolverConfig: { url: "https://example.com/live.m3u8" },
    }
    expect(profileFormErrors(state, RESOLVER)).toEqual({})
  })
})
