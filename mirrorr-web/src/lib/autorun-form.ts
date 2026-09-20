/**
 * D2's pure form state: identity + auto-slug, naive-UTC schedule fields,
 * per-field dirty tracking, the live lock, and the create/update submission
 * rules.
 *
 * Contract:
 * - `docs/web-frontend-spec.md` L402: four steps; `snake_case_name` auto-slugs
 *   from the name with a manual override and the live regex
 *   `^[a-zA-Z0-9_-]+$`; naive-UTC inputs; the helper copy
 *   "Your local time — stored as UTC"; past-start warns but never blocks;
 *   create mode sends the short `profile_id` body only while no config field
 *   is dirty, otherwise the full explicit body (all-or-nothing);
 *   edit mode PUTs only dirty fields.
 * - `docs/general-client-specification.md` §13.11.1–§13.11.2: one-shot
 *   schedule, config edits frozen while live (client-owned protection),
 *   changing `end_time` while live is allowed but warns that it stops the run.
 */
import type { UpdateAutorunBody, CreateAutorunBody } from "@/lib/autoruns-api"
import { DEFAULT_RETRY_MODE, retryModeOptions } from "@/lib/new-session-form"
import { requiredMissing, schemaDefaults } from "@/lib/schema-form"
import type { Autorun } from "@/lib/schemas/autoruns"
import { engineCanRecord, type Engine, type Profile, type Resolver } from "@/lib/schemas/plugins"
import {
  TIME_MESSAGES,
  datetimeLocalToNaiveUtc,
  naiveUtcToDatetimeLocal,
  parseNaiveUtc,
  validateAutorunTimes,
} from "@/lib/time"

export type AutorunFormSource = "profile" | "custom"
export type AutorunFormMode = "create" | "edit"

/** Fields whose edits flip an unedited profile submission to the full form. */
export type AutorunFormField =
  | "user_friendly_name"
  | "snake_case_name"
  | "profile"
  | "engine"
  | "resolver"
  | "resolver_config"
  | "retry_mode"
  | "retry_config"
  | "start_time"
  | "end_time"
  | "recording"

const CONFIG_DIRTY_FIELDS: readonly AutorunFormField[] = [
  "profile",
  "engine",
  "resolver",
  "resolver_config",
  "retry_mode",
  "retry_config",
  "recording",
]

export interface AutorunFormState {
  readonly source: AutorunFormSource
  readonly profileId: number | null
  readonly userFriendlyName: string
  readonly snakeCaseName: string
  /** True once the user edits the slug by hand; auto-slug then stops. */
  readonly slugManuallyEdited: boolean
  readonly engineId: number | null
  readonly resolverId: number | null
  readonly resolverConfig: Record<string, unknown>
  readonly retryMode: string
  readonly retryConfig: Record<string, unknown>
  /** `datetime-local` wall values (minute precision), converted on submit. */
  readonly startLocal: string
  readonly endLocal: string
  readonly recording: boolean
  readonly dirty: ReadonlySet<AutorunFormField>
}

export const AUTORUN_SLUG_PATTERN = /^[a-zA-Z0-9_-]+$/

export const AUTORUN_SLUG_REQUIRED_MESSAGE = "Enter a snake_case name"
export const AUTORUN_SLUG_INVALID_MESSAGE = "Only letters, digits, _ and - are allowed"
export const AUTORUN_NAME_REQUIRED_MESSAGE = "Name is required"
export const AUTORUN_START_REQUIRED_MESSAGE = "Start is required"
export const AUTORUN_END_REQUIRED_MESSAGE = "End is required"

/** The L402 live-edit banner copy, verbatim. */
export const AUTORUN_LIVE_LOCK_MESSAGE =
  "This autorun is running — only name and times can change; setting an end time in the past stops the current run"
/** §13.11.2: the end-time past warning shown while live. */
export const AUTORUN_LIVE_END_WARNING = "Setting an end time in the past stops the current run"

const LIVE_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "recording",
  "terminating",
  "remuxing",
  "finalizing",
])

/** §13.11.2 live family — the config/start lock applies. */
export function isAutorunLiveStatus(status: string): boolean {
  return LIVE_STATUSES.has(status)
}

/** `user_friendly_name` → the auto-slug (`[a-z0-9_-]`, snake_case joining). */
export function buildAutorunSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[-_]+|[-_]+$/g, "")
}

/** The live slug regex; `undefined` when valid. */
export function autorunSlugError(slug: string): string | undefined {
  if (slug.trim().length === 0) return AUTORUN_SLUG_REQUIRED_MESSAGE
  if (!AUTORUN_SLUG_PATTERN.test(slug)) return AUTORUN_SLUG_INVALID_MESSAGE
  return undefined
}

export function createEmptyAutorunForm(): AutorunFormState {
  return {
    source: "custom",
    profileId: null,
    userFriendlyName: "",
    snakeCaseName: "",
    slugManuallyEdited: false,
    engineId: null,
    resolverId: null,
    resolverConfig: {},
    retryMode: DEFAULT_RETRY_MODE,
    retryConfig: {},
    startLocal: "",
    endLocal: "",
    recording: true,
    dirty: new Set(),
  }
}

/** Edit-mode prefill: every value explicit, dirty tracking reset. */
export function autorunFormFromAutorun(autorun: Autorun): AutorunFormState {
  return {
    source: "custom",
    profileId: autorun.profile_id ?? null,
    userFriendlyName: autorun.user_friendly_name,
    snakeCaseName: autorun.snake_case_name,
    slugManuallyEdited: true,
    engineId: autorun.engine_id,
    resolverId: autorun.resolver_id,
    resolverConfig: { ...(autorun.resolver_config ?? {}) },
    retryMode: autorun.retry_mode ?? DEFAULT_RETRY_MODE,
    retryConfig: { ...(autorun.retry_config ?? {}) },
    startLocal: naiveUtcToDatetimeLocal(autorun.start_time),
    endLocal: naiveUtcToDatetimeLocal(autorun.end_time),
    recording: autorun.recording !== false,
    dirty: new Set(),
  }
}

export function markAutorunFormDirty(
  state: AutorunFormState,
  ...fields: readonly AutorunFormField[]
): AutorunFormState {
  if (fields.every((field) => state.dirty.has(field))) return state
  const dirty = new Set(state.dirty)
  for (const field of fields) dirty.add(field)
  return { ...state, dirty }
}

/** Name edit: keeps the auto-slug in sync until the user overrides it. */
export function withAutorunName(state: AutorunFormState, name: string): AutorunFormState {
  if (state.slugManuallyEdited) return markAutorunFormDirty({ ...state, userFriendlyName: name }, "user_friendly_name")
  const slug = buildAutorunSlug(name)
  const next = { ...state, userFriendlyName: name, snakeCaseName: slug }
  const fields: AutorunFormField[] = ["user_friendly_name"]
  if (slug !== state.snakeCaseName) fields.push("snake_case_name")
  return markAutorunFormDirty(next, ...fields)
}

/** Manual slug edit — the auto-slug stops from here on. */
export function withAutorunSlug(state: AutorunFormState, slug: string): AutorunFormState {
  return markAutorunFormDirty({ ...state, snakeCaseName: slug, slugManuallyEdited: true }, "snake_case_name")
}

export function withAutorunStart(state: AutorunFormState, value: string): AutorunFormState {
  return markAutorunFormDirty({ ...state, startLocal: value }, "start_time")
}

export function withAutorunEnd(state: AutorunFormState, value: string): AutorunFormState {
  return markAutorunFormDirty({ ...state, endLocal: value }, "end_time")
}

export function withAutorunRecording(state: AutorunFormState, recording: boolean): AutorunFormState {
  return markAutorunFormDirty({ ...state, recording }, "recording")
}

/** Profile prefill (create mode): all fields editable, dirty tracking reset. */
export function applyAutorunProfile(state: AutorunFormState, profile: Profile): AutorunFormState {
  return {
    ...state,
    source: "profile",
    profileId: profile.id,
    engineId: profile.default_engine_id,
    resolverId: profile.resolver_id,
    resolverConfig: { ...(profile.resolver_config ?? {}) },
    retryMode: profile.retry_mode ?? DEFAULT_RETRY_MODE,
    retryConfig: { ...(profile.retry_config ?? {}) },
    dirty: new Set(),
  }
}

export function applyAutorunEngine(
  state: AutorunFormState,
  engine: Engine | null,
): AutorunFormState {
  if (engine === null) return markAutorunFormDirty({ ...state, engineId: null }, "engine")

  const modes = engine.retry_modes_schema ?? {}
  const retryMode = state.retryMode in modes ? state.retryMode : DEFAULT_RETRY_MODE
  const retryConfig = engine.retry_modes_schema?.[retryMode]?.default_params ?? {}

  return markAutorunFormDirty(
    {
      ...state,
      engineId: engine.id,
      retryMode,
      retryConfig: { ...retryConfig },
      recording: engineCanRecord(engine) ? state.recording : false,
    },
    "engine",
    "retry_mode",
    "retry_config",
  )
}

export function applyAutorunResolver(
  state: AutorunFormState,
  resolver: Resolver | null,
): AutorunFormState {
  if (resolver === null) return markAutorunFormDirty({ ...state, resolverId: null }, "resolver")
  return markAutorunFormDirty(
    {
      ...state,
      resolverId: resolver.id,
      resolverConfig: schemaDefaults(resolver.config_schema),
    },
    "resolver",
    "resolver_config",
  )
}

export function applyAutorunRetryMode(
  state: AutorunFormState,
  engine: Engine | null,
  mode: string,
): AutorunFormState {
  return markAutorunFormDirty(
    {
      ...state,
      retryMode: mode,
      retryConfig: { ...(engine?.retry_modes_schema?.[mode]?.default_params ?? {}) },
    },
    "retry_mode",
    "retry_config",
  )
}

export { retryModeOptions }

/** True when any config field was touched (the create-mode shape switch). */
export function hasConfigDirty(state: AutorunFormState): boolean {
  return CONFIG_DIRTY_FIELDS.some((field) => state.dirty.has(field))
}

/**
 * Create-mode body (L402): an unedited profile selection sends the short
 * `profile_id` form; any config edit sends the full explicit form carrying
 * `engine_id`/`resolver_id`/`resolver_config` in place of `profile_id`.
 * Times are converted from the picker's local wall value to naive UTC.
 */
export function buildAutorunCreateBody(state: AutorunFormState): CreateAutorunBody {
  const start_time = datetimeLocalToNaiveUtc(state.startLocal)
  const end_time = datetimeLocalToNaiveUtc(state.endLocal)
  const identity = {
    user_friendly_name: state.userFriendlyName.trim(),
    snake_case_name: state.snakeCaseName.trim(),
    start_time,
    end_time,
    recording: state.recording,
  }

  if (state.source === "profile" && state.profileId !== null && !hasConfigDirty(state)) {
    return { ...identity, profile_id: state.profileId }
  }

  return {
    ...identity,
    engine_id: state.engineId ?? undefined,
    resolver_id: state.resolverId ?? undefined,
    resolver_config: state.resolverConfig,
    retry_mode: state.retryMode,
    retry_config: state.retryConfig,
  }
}

/**
 * Edit-mode body (L402): dirty fields only. While live, the frozen fields
 * (`start_time` + the config set) are never sent.
 */
export function buildAutorunUpdateBody(
  state: AutorunFormState,
  options: { readonly locked: boolean },
): UpdateAutorunBody {
  const body: { -readonly [K in keyof UpdateAutorunBody]: UpdateAutorunBody[K] } = {}
  const dirty = state.dirty

  if (dirty.has("user_friendly_name")) body.user_friendly_name = state.userFriendlyName.trim()
  if (dirty.has("snake_case_name")) body.snake_case_name = state.snakeCaseName.trim()
  if (dirty.has("end_time")) body.end_time = datetimeLocalToNaiveUtc(state.endLocal)

  if (!options.locked) {
    if (dirty.has("start_time")) body.start_time = datetimeLocalToNaiveUtc(state.startLocal)
    if (dirty.has("engine") && state.engineId !== null) body.engine_id = state.engineId
    if (dirty.has("resolver") && state.resolverId !== null) body.resolver_id = state.resolverId
    if (dirty.has("resolver_config")) body.resolver_config = state.resolverConfig
    if (dirty.has("retry_mode")) body.retry_mode = state.retryMode
    if (dirty.has("retry_config")) body.retry_config = state.retryConfig
    if (dirty.has("recording")) body.recording = state.recording
  }

  return body
}

export interface AutorunFormValidationOptions {
  readonly resolver: Resolver | null
  readonly mode: AutorunFormMode
  readonly locked?: boolean
  readonly now?: Date
  readonly timeZone?: string
}

function timeErrorKey(error: string): { field: "start_time" | "end_time"; message: string } {
  switch (error) {
    case "start-required":
      return { field: "start_time", message: AUTORUN_START_REQUIRED_MESSAGE }
    case "end-required":
      return { field: "end_time", message: AUTORUN_END_REQUIRED_MESSAGE }
    case "end-not-after-start":
      return { field: "end_time", message: TIME_MESSAGES.endNotAfterStart }
    default:
      return { field: "start_time", message: TIME_MESSAGES.invalid }
  }
}

/** Client-side validation mirroring the server schema, plus the time rules. */
export function autorunFormErrors(
  state: AutorunFormState,
  options: AutorunFormValidationOptions,
): Readonly<Record<string, string>> {
  const errors: Record<string, string> = {}

  if (state.userFriendlyName.trim().length === 0) errors.user_friendly_name = AUTORUN_NAME_REQUIRED_MESSAGE
  const slugError = autorunSlugError(state.snakeCaseName)
  if (slugError !== undefined) errors.snake_case_name = slugError

  const times = validateAutorunTimes({
    start: state.startLocal,
    end: state.endLocal,
    now: options.now ?? new Date(),
    timeZone: options.timeZone,
  })
  if (!times.ok) {
    const mapped = timeErrorKey(times.error)
    errors[mapped.field] = mapped.message
  }

  const locked = options.locked === true
  const validateConfig =
    !locked &&
    (options.mode === "create" ? state.source === "custom" || hasConfigDirty(state) : hasConfigDirty(state))

  if (validateConfig) {
    if (state.engineId === null) errors.engine_id = "Select an engine"
    if (state.resolverId === null) errors.resolver_id = "Select a resolver"
    if (options.resolver !== null) {
      for (const key of requiredMissing(options.resolver.config_schema, state.resolverConfig, "resolver_config")) {
        errors[key] = "Required"
      }
    }
  }

  return errors
}

/** The past-start warning (§5: warn, never hard-block). */
export function autorunTimeWarning(
  state: AutorunFormState,
  now: Date = new Date(),
  timeZone?: string,
): string | null {
  if (state.startLocal === "") return null
  try {
    const start = parseNaiveUtc(datetimeLocalToNaiveUtc(state.startLocal, { timeZone }))
    return start.getTime() < now.getTime() ? TIME_MESSAGES.pastStartWarning : null
  } catch {
    return null
  }
}
