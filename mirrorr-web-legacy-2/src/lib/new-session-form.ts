/**
 * D1's pure form state: profile prefill, per-field dirty tracking and the
 * all-or-nothing submission rule.
 *
 * Contract: `docs/web-frontend-spec.md` L401 — selecting a profile prefills
 * every field (still editable); an unedited profile selection submits
 * `{profile_id, recording}` only; a single field edit makes the submission the
 * full explicit form `{engine_id, resolver_id, resolver_config, retry_mode,
 * retry_config, recording}`. The server snapshots the config on the session,
 * so the client never sends a mix of the two shapes.
 */
import { schemaDefaults, requiredMissing } from "@/lib/schema-form"
import { engineCanRecord, type Engine, type Profile, type Resolver } from "@/lib/schemas/plugins"
import type { CreateSessionBody } from "@/lib/sessions-api"

export type SessionFormSource = "profile" | "custom"

/** Fields whose edits flip an unedited profile submission to the full form. */
export type SessionFormField =
  | "profile"
  | "engine"
  | "resolver"
  | "resolver_config"
  | "retry_mode"
  | "retry_config"
  | "recording"

export interface SessionFormState {
  readonly source: SessionFormSource
  readonly profileId: number | null
  readonly engineId: number | null
  readonly resolverId: number | null
  readonly resolverConfig: Record<string, unknown>
  readonly retryMode: string
  readonly retryConfig: Record<string, unknown>
  readonly recording: boolean
  readonly dirty: ReadonlySet<SessionFormField>
}

export const DEFAULT_RETRY_MODE = "none"

/** Fresh state per dialog open (a new Set each time — never shared). */
export function createEmptySessionForm(): SessionFormState {
  return {
    source: "custom",
    profileId: null,
    engineId: null,
    resolverId: null,
    resolverConfig: {},
    retryMode: DEFAULT_RETRY_MODE,
    retryConfig: {},
    recording: false,
    dirty: new Set(),
  }
}

export function markSessionFormDirty(
  state: SessionFormState,
  ...fields: readonly SessionFormField[]
): SessionFormState {
  if (fields.every((field) => state.dirty.has(field))) return state
  const dirty = new Set(state.dirty)
  for (const field of fields) dirty.add(field)
  return { ...state, dirty }
}

/** Profile prefill: all fields editable, dirty tracking reset. */
export function applyProfile(state: SessionFormState, profile: Profile): SessionFormState {
  return {
    source: "profile",
    profileId: profile.id,
    engineId: profile.default_engine_id,
    resolverId: profile.resolver_id,
    resolverConfig: { ...(profile.resolver_config ?? {}) },
    retryMode: profile.retry_mode ?? DEFAULT_RETRY_MODE,
    retryConfig: { ...(profile.retry_config ?? {}) },
    recording: state.recording,
    dirty: new Set(),
  }
}

/**
 * Engine change: keep the current retry mode when the engine declares it,
 * otherwise fall back to `none`; a `can_record:false` engine clears recording.
 */
export function applyEngine(state: SessionFormState, engine: Engine | null): SessionFormState {
  if (engine === null) return { ...state, engineId: null }

  const modes = engine.retry_modes_schema ?? {}
  const retryMode = state.retryMode in modes ? state.retryMode : DEFAULT_RETRY_MODE
  const retryConfig = engine.retry_modes_schema?.[retryMode]?.default_params ?? {}

  return {
    ...state,
    engineId: engine.id,
    retryMode,
    retryConfig: { ...retryConfig },
    recording: engineCanRecord(engine) ? state.recording : false,
  }
}

/** Resolver change: prefill that resolver's declared config defaults. */
export function applyResolver(state: SessionFormState, resolver: Resolver | null): SessionFormState {
  if (resolver === null) return { ...state, resolverId: null }
  return {
    ...state,
    resolverId: resolver.id,
    resolverConfig: schemaDefaults(resolver.config_schema),
  }
}

export function applyRetryMode(state: SessionFormState, engine: Engine | null, mode: string): SessionFormState {
  return {
    ...state,
    retryMode: mode,
    retryConfig: { ...(engine?.retry_modes_schema?.[mode]?.default_params ?? {}) },
  }
}

export function retryModeOptions(engine: Engine | null): readonly string[] {
  const modes = Object.keys(engine?.retry_modes_schema ?? {})
  return modes.length > 0 ? modes : [DEFAULT_RETRY_MODE]
}

/**
 * The one submission builder. An unedited profile selection is the short
 * body; everything else is the full explicit form.
 */
export function buildSessionRequest(state: SessionFormState): CreateSessionBody {
  if (state.source === "profile" && state.profileId !== null && state.dirty.size === 0) {
    return { profile_id: state.profileId, recording: state.recording }
  }

  return {
    engine_id: state.engineId ?? undefined,
    resolver_id: state.resolverId ?? undefined,
    resolver_config: state.resolverConfig,
    retry_mode: state.retryMode,
    retry_config: state.retryConfig,
    recording: state.recording,
  }
}

/**
 * Client-side validation mirroring the server's schema requirements. Keys are
 * dotted paths matching a 422 `loc` (`resolver_config.url`).
 */
export function sessionFormErrors(
  state: SessionFormState,
  resolver: Resolver | null,
): Readonly<Record<string, string>> {
  const errors: Record<string, string> = {}
  if (state.engineId === null) errors.engine_id = "Select an engine"
  if (state.resolverId === null) errors.resolver_id = "Select a resolver"

  if (resolver !== null) {
    for (const key of requiredMissing(resolver.config_schema, state.resolverConfig, "resolver_config")) {
      errors[key] = "Required"
    }
  }

  return errors
}
