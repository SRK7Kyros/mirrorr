/**
 * Import wizard pure logic — V10 (`docs/web-frontend-spec.md` L347-L362).
 *
 * Everything in this module is deterministic and side-effect free: the
 * client-side file guards, the validate-report derivations (badges, mapping
 * requirements, rename previews), the four-step reducer, and the
 * `<edited bundle> + plugin_map + removed_*` apply encoding. The React
 * component is a thin shell over these functions, so the unit tests here are
 * the contract for the wizard's behavior.
 */
import {
  bundleSchema,
  type ApplyBody,
  type ApplyResponse,
  type Bundle,
  type BundleAutorun,
  type PluginMap,
  type ValidateItem,
  type ValidateReport,
} from "@/lib/schemas/import-export"

/** The only bundle version this client understands (contract §9.1). */
export const SUPPORTED_BUNDLE_VERSION = 1

/** Hard client-side block before validate (spec V10 states). */
export const MAX_BUNDLE_ITEMS = 500

export const INVALID_JSON_MESSAGE = "That file is not valid JSON."
export const UNSUPPORTED_VERSION_MESSAGE = "Unsupported bundle version"
export const INVALID_BUNDLE_MESSAGE = "That file is not a Mirrorr bundle."
export const TOO_LARGE_MESSAGE = "Bundle exceeds 500 items"

export const ISSUE_BADGE_LABELS = {
  ready: "Ready",
  skip: "Skip — already imported",
  mapping: "Needs mapping",
  conflict: "Conflict",
} as const

export type BadgeKey = keyof typeof ISSUE_BADGE_LABELS

export interface IssueBadge {
  readonly key: BadgeKey
  readonly label: string
}

const MAPPING_PROBLEMS = new Set(["not_installed", "hash_mismatch"])
const CONFLICT_PROBLEMS = new Set(["name_conflict", "profile_missing", "engine_override"])

/**
 * Derives the spec badge for one validate report item.
 *
 * `not_installed`/`hash_mismatch` are the plugin problems the user resolves
 * with a mapping picker, so they win over a same-item conflict (mapping is
 * mandatory); every other problem — including problems a future server adds —
 * demands attention and shows as Conflict.
 */
export function badgeForItem(item: ValidateItem): IssueBadge {
  const problems = item.issues.map((issue) => issue.problem)
  if (problems.some((problem) => MAPPING_PROBLEMS.has(problem))) {
    return { key: "mapping", label: ISSUE_BADGE_LABELS.mapping }
  }
  if (problems.some((problem) => CONFLICT_PROBLEMS.has(problem))) {
    return { key: "conflict", label: ISSUE_BADGE_LABELS.conflict }
  }
  if (problems.includes("already_exists")) {
    return { key: "skip", label: ISSUE_BADGE_LABELS.skip }
  }
  if (problems.length > 0) {
    return { key: "conflict", label: ISSUE_BADGE_LABELS.conflict }
  }
  return { key: "ready", label: ISSUE_BADGE_LABELS.ready }
}

export type BundleGuardResult =
  | { readonly ok: true; readonly bundle: Bundle }
  | { readonly ok: false; readonly message: string }

/** Client-side guards: JSON parse → `version === 1` → >500 → shape. */
export function parseBundleText(text: string): BundleGuardResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, message: INVALID_JSON_MESSAGE }
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: INVALID_BUNDLE_MESSAGE }
  }
  const record = raw as { readonly version?: unknown; readonly profiles?: unknown; readonly autoruns?: unknown }
  if (record.version !== SUPPORTED_BUNDLE_VERSION) {
    return { ok: false, message: UNSUPPORTED_VERSION_MESSAGE }
  }
  if (
    (Array.isArray(record.profiles) && record.profiles.length > MAX_BUNDLE_ITEMS) ||
    (Array.isArray(record.autoruns) && record.autoruns.length > MAX_BUNDLE_ITEMS)
  ) {
    return { ok: false, message: TOO_LARGE_MESSAGE }
  }
  const parsed = bundleSchema.safeParse(record)
  if (!parsed.success) {
    return { ok: false, message: INVALID_BUNDLE_MESSAGE }
  }
  return { ok: true, bundle: parsed.data }
}

export interface MappingRequirement {
  readonly key: string
  readonly field: "engine" | "resolver"
  readonly pluginType: "engine" | "resolver"
  readonly originHash: string
  readonly bundledName: string
  readonly itemName: string
  readonly defaultPluginId: number | null
}

function requirementsForItem(item: ValidateItem): readonly MappingRequirement[] {
  const requirements: MappingRequirement[] = []
  for (const issue of item.issues) {
    if (!MAPPING_PROBLEMS.has(issue.problem)) continue
    const originHash = issue.bundled?.origin_hash
    if (originHash === undefined || originHash === "") continue
    const field = issue.field === "resolver" ? "resolver" : "engine"
    requirements.push({
      key: `${field}:${originHash}`,
      field,
      pluginType: field,
      originHash,
      bundledName: issue.bundled?.name ?? "",
      itemName: item.name,
      defaultPluginId: issue.installed?.id ?? null,
    })
  }
  return requirements
}

/** One requirement per distinct `not_installed`/`hash_mismatch` hash. */
export function mappingRequirements(report: ValidateReport): readonly MappingRequirement[] {
  const byKey = new Map<string, MappingRequirement>()
  for (const item of [...report.profiles, ...report.autoruns]) {
    for (const requirement of requirementsForItem(item)) {
      if (!byKey.has(requirement.key)) byKey.set(requirement.key, requirement)
    }
  }
  return [...byKey.values()]
}

export interface ProfileMissingRequirement {
  readonly autorunName: string
  readonly profileName: string
}

export function profileMissingRequirements(report: ValidateReport): readonly ProfileMissingRequirement[] {
  const requirements: ProfileMissingRequirement[] = []
  for (const item of report.autoruns) {
    for (const issue of item.issues) {
      if (issue.problem !== "profile_missing") continue
      requirements.push({ autorunName: item.name, profileName: issue.profile_name ?? "" })
    }
  }
  return requirements
}

export interface EngineOverrideRequirement {
  readonly autorunName: string
  readonly engineName: string
}

/** An autorun entry carries an inline engine override when it has `engine_override`. */
export function engineOverrideRequirements(bundle: Bundle): readonly EngineOverrideRequirement[] {
  const requirements: EngineOverrideRequirement[] = []
  for (const entry of bundle.autoruns) {
    if (entry.engine_override === undefined) continue
    requirements.push({ autorunName: entry.user_friendly_name, engineName: entry.engine_override.name })
  }
  return requirements
}

/**
 * Preview of the auto-rename the server would apply (`name_2`…`name_199`,
 * contract §9.3). `reserved` carries names already previewed in this batch so
 * two conflicts do not both render `name_2`.
 */
export function renamePreview(name: string, installedNames: readonly string[], reserved: readonly string[] = []): string {
  const taken = new Set([...installedNames, ...reserved])
  if (!taken.has(name)) return name
  for (let suffix = 2; suffix < 200; suffix += 1) {
    const candidate = `${name}_${suffix}`
    if (!taken.has(candidate)) return candidate
  }
  return `${name}_199`
}

export type ProfileMissingResolution = { readonly kind: "bind"; readonly profileName: string } | { readonly kind: "inline" }
export type EngineOverrideResolution = "keep" | "inherit"

export type WizardStep = "choose" | "review" | "resolve" | "apply"
export type WizardStatus = "idle" | "validating" | "ready" | "applying" | "applied"

export interface WizardState {
  readonly step: WizardStep
  readonly fileName: string | null
  readonly bundle: Bundle | null
  readonly report: ValidateReport | null
  readonly mappings: Readonly<Record<string, number>>
  readonly profileMissing: Readonly<Record<string, ProfileMissingResolution>>
  readonly engineOverrides: Readonly<Record<string, EngineOverrideResolution>>
  readonly excludedProfiles: readonly string[]
  readonly excludedAutoruns: readonly string[]
  readonly status: WizardStatus
  readonly guardError: string | null
  readonly validationError: string | null
  readonly applyError: string | null
  readonly summary: ApplyResponse | null
}

export const initialWizardState: WizardState = {
  step: "choose",
  fileName: null,
  bundle: null,
  report: null,
  mappings: {},
  profileMissing: {},
  engineOverrides: {},
  excludedProfiles: [],
  excludedAutoruns: [],
  status: "idle",
  guardError: null,
  validationError: null,
  applyError: null,
  summary: null,
}

export type WizardAction =
  | { readonly type: "file-selected"; readonly fileName: string }
  | { readonly type: "file-rejected"; readonly message: string }
  | { readonly type: "file-parsed"; readonly fileName: string; readonly bundle: Bundle }
  | { readonly type: "validation-started" }
  | { readonly type: "validation-succeeded"; readonly report: ValidateReport }
  | { readonly type: "validation-failed"; readonly message: string }
  | { readonly type: "back" }
  | { readonly type: "next" }
  | { readonly type: "mapping-changed"; readonly key: string; readonly pluginId: number }
  | { readonly type: "profile-missing-changed"; readonly autorunName: string; readonly resolution: ProfileMissingResolution }
  | { readonly type: "engine-override-changed"; readonly autorunName: string; readonly resolution: EngineOverrideResolution }
  | { readonly type: "include-toggled"; readonly kind: "profile" | "autorun"; readonly name: string; readonly included: boolean }
  | { readonly type: "apply-started" }
  | { readonly type: "apply-succeeded"; readonly summary: ApplyResponse }
  | { readonly type: "apply-failed"; readonly message: string }
  | { readonly type: "reset" }

function toggleExclusion(list: readonly string[], name: string, included: boolean): readonly string[] {
  if (included) return list.filter((entry) => entry !== name)
  return list.includes(name) ? list : [...list, name]
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "file-selected":
      return { ...state, fileName: action.fileName, guardError: null, validationError: null }
    case "file-rejected":
      return {
        ...state,
        fileName: null,
        bundle: null,
        report: null,
        guardError: action.message,
        validationError: null,
        status: "idle",
      }
    case "file-parsed":
      return { ...state, fileName: action.fileName, bundle: action.bundle, guardError: null, status: "ready" }
    case "validation-started":
      return { ...state, status: "validating", validationError: null, guardError: null }
    case "validation-succeeded":
      return { ...state, step: "review", report: action.report, status: "ready", validationError: null }
    case "validation-failed":
      return { ...state, status: "ready", validationError: action.message }
    case "back":
      if (state.step === "review") return { ...state, step: "choose" }
      if (state.step === "resolve") return { ...state, step: "review" }
      return state
    case "next":
      if (state.step === "choose" && state.bundle !== null) return { ...state, step: "review" }
      if (state.step === "review") return { ...state, step: "resolve" }
      return state
    case "mapping-changed":
      return { ...state, mappings: { ...state.mappings, [action.key]: action.pluginId } }
    case "profile-missing-changed":
      return {
        ...state,
        profileMissing: { ...state.profileMissing, [action.autorunName]: action.resolution },
      }
    case "engine-override-changed":
      return {
        ...state,
        engineOverrides: { ...state.engineOverrides, [action.autorunName]: action.resolution },
      }
    case "include-toggled": {
      if (action.kind === "profile") {
        return { ...state, excludedProfiles: toggleExclusion(state.excludedProfiles, action.name, action.included) }
      }
      return { ...state, excludedAutoruns: toggleExclusion(state.excludedAutoruns, action.name, action.included) }
    }
    case "apply-started":
      return { ...state, status: "applying", applyError: null }
    case "apply-succeeded":
      return { ...state, step: "apply", status: "applied", summary: action.summary, applyError: null }
    case "apply-failed":
      return { ...state, step: "resolve", status: "ready", applyError: action.message }
    case "reset":
      return initialWizardState
  }
}

function editAutorun(entry: BundleAutorun, state: WizardState): BundleAutorun {
  let next: BundleAutorun = { ...entry }
  const missing = state.profileMissing[entry.user_friendly_name]
  if (missing?.kind === "bind") {
    next = { ...next, profile_name: missing.profileName, profile: { name: missing.profileName } }
  } else if (missing?.kind === "inline") {
    const { profile: _dropped, ...rest } = next
    next = rest
  }
  if (state.engineOverrides[entry.user_friendly_name] === "inherit") {
    const { engine_override: _dropped, ...rest } = next
    next = rest
  }
  return next
}

/** The bundle as edited by the user (exclusions, binds, inlines, inherits). */
export function editedBundle(state: WizardState): Bundle | null {
  if (state.bundle === null) return null
  return {
    ...state.bundle,
    profiles: state.bundle.profiles.filter((profile) => !state.excludedProfiles.includes(profile.name)),
    autoruns: state.bundle.autoruns
      .filter((autorun) => !state.excludedAutoruns.includes(autorun.user_friendly_name))
      .map((autorun) => editAutorun(autorun, state)),
  }
}

/**
 * The apply payload (spec L359-L362). Key order is fixed — bundle, plugin_map,
 * then the optional removed_* arrays — and plugin_map keys are sorted so the
 * same inputs always serialize to the same bytes.
 */
export function applyBody(state: WizardState): ApplyBody | null {
  const bundle = editedBundle(state)
  if (bundle === null || state.report === null) return null
  const entries: Array<readonly [string, { readonly type: "engine" | "resolver"; readonly id: number }]> = []
  for (const requirement of mappingRequirements(state.report)) {
    const pluginId = state.mappings[requirement.key]
    if (pluginId === undefined) continue
    entries.push([requirement.originHash, { type: requirement.pluginType, id: pluginId }])
  }
  entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  const pluginMap: PluginMap = Object.fromEntries(entries)
  let body: ApplyBody = { bundle, plugin_map: pluginMap }
  if (state.excludedProfiles.length > 0) body = { ...body, removed_profiles: [...state.excludedProfiles] }
  if (state.excludedAutoruns.length > 0) body = { ...body, removed_autoruns: [...state.excludedAutoruns] }
  return body
}

/** Requirements the user still has to resolve before Apply unlocks. */
export function unresolvedCount(state: WizardState): number {
  if (state.report === null) return 0
  let count = 0
  for (const requirement of mappingRequirements(state.report)) {
    if (state.mappings[requirement.key] === undefined) count += 1
  }
  for (const requirement of profileMissingRequirements(state.report)) {
    const resolution = state.profileMissing[requirement.autorunName]
    if (resolution === undefined || (resolution.kind === "bind" && resolution.profileName === "")) count += 1
  }
  return count
}

export function canApply(state: WizardState): boolean {
  return state.step === "resolve" && state.status === "ready" && unresolvedCount(state) === 0
}
