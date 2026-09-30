/**
 * V8's editor form state: engine/resolver pickers, the dynamic config
 * prefills, and the submitted `POST/PUT /profiles/` body.
 *
 * Contract: `docs/web-frontend-spec.md` L331 and
 * `docs/general-client-specification.md` §3 — `resolver_config` comes from the
 * resolver's `config_schema`, `retry_config` from the engine's
 * `retry_modes_schema[mode]`; a mode change re-renders the matching schema.
 * Pure state so the editor and its tests share one source.
 */
import type { CreateProfileBody } from "@/lib/profiles-api"
import { prefillValues, requiredMissing } from "@/lib/schema-form"
import type { Engine, Profile, Resolver } from "@/lib/schemas/plugins"

export const DEFAULT_PROFILE_RETRY_MODE = "none"

export interface ProfileFormState {
  readonly name: string
  readonly engineId: number | null
  readonly resolverId: number | null
  readonly resolverConfig: Record<string, unknown>
  readonly retryMode: string
  readonly retryConfig: Record<string, unknown>
}

export function createEmptyProfileForm(): ProfileFormState {
  return {
    name: "",
    engineId: null,
    resolverId: null,
    resolverConfig: {},
    retryMode: DEFAULT_PROFILE_RETRY_MODE,
    retryConfig: {},
  }
}

/** Edit-mode prefill; configs are copied, never aliased. */
export function profileFormFromProfile(profile: Profile): ProfileFormState {
  return {
    name: profile.name,
    engineId: profile.default_engine_id,
    resolverId: profile.resolver_id,
    resolverConfig: { ...(profile.resolver_config ?? {}) },
    retryMode: profile.retry_mode ?? DEFAULT_PROFILE_RETRY_MODE,
    retryConfig: { ...(profile.retry_config ?? {}) },
  }
}

/**
 * Engine change: keep the current retry mode when the engine declares it,
 * otherwise fall back to `none`; the config prefills from that mode's
 * `default_params`.
 */
export function applyProfileEngine(state: ProfileFormState, engine: Engine | null): ProfileFormState {
  if (engine === null) return { ...state, engineId: null }

  const modes = engine.retry_modes_schema ?? {}
  const retryMode = state.retryMode in modes ? state.retryMode : DEFAULT_PROFILE_RETRY_MODE
  return {
    ...state,
    engineId: engine.id,
    retryMode,
    retryConfig: { ...(modes[retryMode]?.default_params ?? {}) },
  }
}

/** Resolver change: `config_schema` defaults prefill the resolver config. */
export function applyProfileResolver(state: ProfileFormState, resolver: Resolver | null): ProfileFormState {
  if (resolver === null) return { ...state, resolverId: null }
  return {
    ...state,
    resolverId: resolver.id,
    resolverConfig: prefillValues(resolver.config_schema),
  }
}

export function applyProfileRetryMode(
  state: ProfileFormState,
  engine: Engine | null,
  mode: string,
): ProfileFormState {
  return {
    ...state,
    retryMode: mode,
    retryConfig: { ...(engine?.retry_modes_schema?.[mode]?.default_params ?? {}) },
  }
}

export function retryModeOptions(engine: Engine | null): readonly string[] {
  const modes = Object.keys(engine?.retry_modes_schema ?? {})
  return modes.length > 0 ? modes : [DEFAULT_PROFILE_RETRY_MODE]
}

/** The full submission body, or `null` while a required pick is missing. */
export function buildProfileBody(state: ProfileFormState): CreateProfileBody | null {
  const name = state.name.trim()
  if (name.length === 0 || state.engineId === null || state.resolverId === null) return null

  return {
    name,
    default_engine_id: state.engineId,
    resolver_id: state.resolverId,
    resolver_config: state.resolverConfig,
    retry_mode: state.retryMode,
    retry_config: state.retryConfig,
  }
}

/**
 * Client-side validation mirroring the server. Keys are dotted paths matching
 * a 422 `loc` (`resolver_config.url`).
 */
export function profileFormErrors(
  state: ProfileFormState,
  resolver: Resolver | null,
): Readonly<Record<string, string>> {
  const errors: Record<string, string> = {}
  if (state.name.trim().length === 0) errors.name = "Enter a name"
  if (state.engineId === null) errors.default_engine_id = "Select an engine"
  if (state.resolverId === null) errors.resolver_id = "Select a resolver"

  if (resolver !== null) {
    for (const key of requiredMissing(resolver.config_schema, state.resolverConfig, "resolver_config")) {
      errors[key] = "Required"
    }
  }

  return errors
}
