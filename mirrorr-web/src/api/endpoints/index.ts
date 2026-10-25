import { ApiError, apiFetch } from "@/api/client"
import { PAGE_SIZE, fetchAllLookupPages, type CursorPage } from "@/api/query-keys"
import {
  AutorunSchema,
  DiscoveryPageSchema,
  EngineSchema,
  ProfileSchema,
  RecordingSchema,
  ResolverSchema,
  ResolverSourceSchema,
  SessionSchema,
  cursorPageSchema,
  type Autorun,
  type DiscoveryPage,
  type Engine,
  type Profile,
  type Resolver,
  type ResolverSource,
  type Session,
} from "@/api/schemas"
import { z } from "zod"

/**
 * View-layer endpoint wrappers — exact paths per the Endpoint Coverage
 * Matrix (lists carry a trailing slash; items/controls do not). Every
 * response is Zod-parsed on first parse; parse failure warns and throws
 * `ApiError(0, "Unexpected server response")` so queryClient's retry:1 is
 * the contract's "refetch once" and the second failure lands in the view
 * error state.
 */

function parseOrWarn<T>(parse: (raw: unknown) => T, raw: unknown): T {
  try {
    return parse(raw)
  } catch (error) {
    console.warn("Response failed schema validation", error)
    throw new ApiError(0, "Unexpected server response")
  }
}

function listQuery(cursor: number | undefined, limit: number, extra = ""): string {
  return cursor === undefined ? `?limit=${limit}${extra}` : `?cursor=${cursor}&limit=${limit}${extra}`
}

/** `DeleteResultResponse` — what a delete cascaded, detached or flagged. */
const DeleteCountsSchema = z.object({
  deleted: z.record(z.string(), z.number()).optional(),
})

async function fetchPageOf<T>(
  path: string,
  item: z.ZodType<T>,
  cursor: number | undefined,
  limit: number,
  extra = "",
): Promise<CursorPage<T>> {
  const schema = cursorPageSchema(item)
  const raw = await apiFetch<unknown>(`${path}${listQuery(cursor, limit, extra)}`)
  return parseOrWarn((value) => schema.parse(value), raw)
}

/* ── sessions ─────────────────────────────────────────────────────── */
export function fetchSessionPage(
  cursor: number | undefined,
  limit = PAGE_SIZE,
  autorun?: number | string,
) {
  const extra = autorun === undefined ? "" : `&autorun=${encodeURIComponent(String(autorun))}`
  return fetchPageOf("/sessions/", SessionSchema, cursor, limit, extra)
}
export function fetchSession(id: number | string): Promise<Session> {
  return apiFetch<unknown>(`/sessions/${id}`).then((raw) => parseOrWarn(SessionSchema.parse, raw))
}
/** A fallback that swaps only the source — a resolver plus its config. */
export interface FallbackSourceBody {
  readonly resolver_id: number
  readonly resolver_config?: Record<string, unknown> | null
}
export interface SessionCreateBody {
  readonly profile_id?: number
  readonly fallback_profile_ids?: readonly number[]
  readonly fallback_sources?: readonly FallbackSourceBody[]
  readonly engine_id?: number
  readonly resolver_id?: number
  readonly resolver_config?: Record<string, unknown>
  readonly retry_mode?: string
  readonly retry_config?: Record<string, unknown>
  readonly recording: boolean
}
export function createSession(body: SessionCreateBody): Promise<Session> {
  return apiFetch<unknown>("/sessions/", { body }).then((raw) => parseOrWarn(SessionSchema.parse, raw))
}
export function stopSession(id: number): Promise<void> {
  return apiFetch<void>(`/sessions/${id}/stop`, { method: "POST" })
}
export function setSessionRecording(id: number, enable: boolean): Promise<void> {
  return apiFetch<void>(`/sessions/${id}/recording/${enable ? "enable" : "disable"}`, { method: "POST" })
}
export function deleteSession(id: number): Promise<void> {
  return apiFetch<void>(`/sessions/${id}`, { method: "DELETE" })
}
export function saveSessionAsProfile(id: number, name: string): Promise<Profile> {
  return apiFetch<unknown>(`/sessions/${id}/save-as-profile`, { body: { name } }).then((raw) =>
    parseOrWarn(ProfileSchema.parse, raw),
  )
}

/* ── autoruns ─────────────────────────────────────────────────────── */
export function fetchAutorunPage(cursor: number | undefined, limit = PAGE_SIZE) {
  return fetchPageOf("/autoruns/", AutorunSchema, cursor, limit)
}
export function fetchAutorun(id: number | string): Promise<Autorun> {
  return apiFetch<unknown>(`/autoruns/${id}`).then((raw) => parseOrWarn(AutorunSchema.parse, raw))
}
export interface AutorunBody {
  readonly user_friendly_name?: string
  readonly snake_case_name?: string
  readonly profile_id?: number | null
  readonly engine_id?: number
  readonly resolver_id?: number
  readonly resolver_config?: Record<string, unknown>
  readonly retry_mode?: string
  readonly retry_config?: Record<string, unknown>
  readonly start_time?: string
  readonly end_time?: string
  readonly recording?: boolean
  readonly orphan_policy?: string
  readonly fallback_profile_ids?: readonly number[]
  readonly fallback_sources?: readonly FallbackSourceBody[]
}
export function createAutorun(body: AutorunBody): Promise<Autorun> {
  return apiFetch<unknown>("/autoruns/", { body }).then((raw) => parseOrWarn(AutorunSchema.parse, raw))
}
export function updateAutorun(id: number, body: AutorunBody): Promise<Autorun> {
  return apiFetch<unknown>(`/autoruns/${id}`, { method: "PUT", body }).then((raw) =>
    parseOrWarn(AutorunSchema.parse, raw),
  )
}
export function deleteAutorun(id: number): Promise<void> {
  return apiFetch<void>(`/autoruns/${id}`, { method: "DELETE" })
}
export function saveAutorunAsProfile(id: number, name: string): Promise<Profile> {
  return apiFetch<unknown>(`/autoruns/${id}/save-as-profile`, { body: { name } }).then((raw) =>
    parseOrWarn(ProfileSchema.parse, raw),
  )
}

/* ── recordings ───────────────────────────────────────────────────── */
export function fetchRecordingPage(cursor: number | undefined, limit = PAGE_SIZE) {
  return fetchPageOf("/recordings/", RecordingSchema, cursor, limit)
}
export function deleteRecording(id: number): Promise<void> {
  return apiFetch<void>(`/recordings/${id}`, { method: "DELETE" })
}

/* ── profiles ─────────────────────────────────────────────────────── */
export function fetchProfilePage(cursor: number | undefined, limit = PAGE_SIZE) {
  return fetchPageOf("/profiles/", ProfileSchema, cursor, limit)
}
export interface ProfileBody {
  readonly name?: string
  readonly default_engine_id?: number
  readonly resolver_id?: number
  readonly resolver_config?: Record<string, unknown>
  readonly retry_mode?: string
  readonly retry_config?: Record<string, unknown>
}
export function createProfile(body: ProfileBody): Promise<Profile> {
  return apiFetch<unknown>("/profiles/", { body }).then((raw) => parseOrWarn(ProfileSchema.parse, raw))
}
export function fetchProfile(id: number | string): Promise<Profile> {
  return apiFetch<unknown>(`/profiles/${id}`).then((raw) => parseOrWarn(ProfileSchema.parse, raw))
}
export function updateProfile(id: number, body: ProfileBody): Promise<Profile> {
  return apiFetch<unknown>(`/profiles/${id}`, { method: "PUT", body }).then((raw) =>
    parseOrWarn(ProfileSchema.parse, raw),
  )
}
export function deleteProfile(id: number): Promise<Record<string, number>> {
  return apiFetch<unknown>(`/profiles/${id}`, { method: "DELETE" }).then((raw) => {
    const parsed = DeleteCountsSchema.safeParse(raw)
    return parsed.success ? (parsed.data.deleted ?? {}) : {}
  })
}

/* ── sources ──────────────────────────────────────────────────────── */
export function fetchSourcePage(cursor: number | undefined, limit = PAGE_SIZE) {
  return fetchPageOf("/sources/", ResolverSourceSchema, cursor, limit)
}
export interface SourceBody {
  readonly name?: string
  readonly resolver_id?: number
  readonly resolver_config?: Record<string, unknown>
}
export function createSource(body: SourceBody): Promise<ResolverSource> {
  return apiFetch<unknown>("/sources/", { body }).then((raw) => parseOrWarn(ResolverSourceSchema.parse, raw))
}
export function updateSource(id: number, body: SourceBody): Promise<ResolverSource> {
  return apiFetch<unknown>(`/sources/${id}`, { method: "PUT", body }).then((raw) =>
    parseOrWarn(ResolverSourceSchema.parse, raw),
  )
}
export function deleteSource(id: number): Promise<void> {
  return apiFetch<void>(`/sources/${id}`, { method: "DELETE" })
}

/* ── resolver discovery ───────────────────────────────────────────── */
export interface DiscoveryBody {
  readonly query?: string
  readonly params?: Record<string, unknown>
  readonly cursor?: string | null
}
export function discoverResolver(id: number | string, body: DiscoveryBody): Promise<DiscoveryPage> {
  return apiFetch<unknown>(`/resolvers/${id}/discover`, { method: "POST", body }).then((raw) =>
    parseOrWarn(DiscoveryPageSchema.parse, raw),
  )
}

/* ── plugins (lookups) ────────────────────────────────────────────── */
export function fetchEnginePage(cursor: number | undefined, limit = PAGE_SIZE) {
  return fetchPageOf("/engines/", EngineSchema, cursor, limit)
}
export function fetchResolverPage(cursor: number | undefined, limit = PAGE_SIZE) {
  return fetchPageOf("/resolvers/", ResolverSchema, cursor, limit)
}
export function fetchAllEngines(limit = PAGE_SIZE): Promise<Engine[]> {
  return fetchAllLookupPages((cursor) => fetchEnginePage(cursor, limit))
}
export function fetchAllResolvers(limit = PAGE_SIZE): Promise<Resolver[]> {
  return fetchAllLookupPages((cursor) => fetchResolverPage(cursor, limit))
}

/* ── import / export ──────────────────────────────────────────────── */
export function fetchProfileExport(id: number): Promise<unknown> {
  return apiFetch<unknown>(`/import-export/profiles/${id}/export`)
}
export function fetchAutorunExport(id: number): Promise<unknown> {
  return apiFetch<unknown>(`/import-export/autoruns/${id}/export`)
}

export interface ImportIssue {
  readonly type: string
  readonly [key: string]: unknown
}
export interface ImportItem {
  readonly name: string
  readonly kind: string
  readonly content_hash?: string
  readonly status: string
  readonly issues: readonly ImportIssue[]
  readonly entry: Record<string, unknown>
}
export interface ImportValidateReport {
  readonly items: readonly ImportItem[]
}

const IssueSchema = z.record(z.string(), z.unknown())
const ItemSchema = z
  .object({
    name: z.string(),
    kind: z.string().optional(),
    content_hash: z.string().optional(),
    status: z.string().optional(),
    issues: z.array(IssueSchema).optional(),
    entry: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()
const ValidateSchema = z
  .object({
    items: z.array(ItemSchema).optional(),
    profiles: z.array(ItemSchema).optional(),
    autoruns: z.array(ItemSchema).optional(),
  })
  .passthrough()

/** Normalizes `{items}` or `{profiles, autoruns}` validate shapes. */
export function normalizeValidateReport(raw: unknown): ImportValidateReport {
  const parsed = parseOrWarn(ValidateSchema.parse, raw)
  const items: ImportItem[] = []
  const push = (entries: readonly z.infer<typeof ItemSchema>[] | undefined, kind: string) => {
    for (const entry of entries ?? []) {
      items.push({
        name: entry.name,
        kind: entry.kind ?? kind,
        ...(entry.content_hash === undefined ? {} : { content_hash: entry.content_hash }),
        status: entry.status ?? "ready",
        issues: (entry.issues ?? []).map((raw) => ({
          ...raw,
          type: typeof raw.problem === "string" ? raw.problem : typeof raw.type === "string" ? raw.type : "other",
        })),
        entry: entry.entry ?? (entry as Record<string, unknown>),
      })
    }
  }
  push(parsed.items, "profile")
  push(parsed.profiles, "profile")
  push(parsed.autoruns, "autorun")
  return { items }
}

export function validateBundle(bundle: unknown): Promise<ImportValidateReport> {
  return apiFetch<unknown>("/import-export/validate", { body: bundle }).then(normalizeValidateReport)
}

/** Read a bundle from a direct-file URL. The server fetches it, so CORS does not apply. */
export function fetchBundleFromUrl(url: string): Promise<unknown> {
  return apiFetch<unknown>("/import-export/fetch", { body: { url } })
}

export interface DiscardedAutorun {
  readonly name: string
  readonly start_time: string
}
export interface ImportApplySummary {
  readonly profiles_created: number
  readonly profiles_skipped: number
  readonly autoruns_created: number
  readonly autoruns_discarded: number
  readonly discarded_autoruns: readonly DiscardedAutorun[]
}
const DiscardedAutorunSchema = z
  .object({ name: z.string(), start_time: z.string() })
  .passthrough()
const ApplySummarySchema = z
  .object({
    profiles_created: z.number().optional(),
    profiles_skipped: z.number().optional(),
    autoruns_created: z.number().optional(),
    autoruns_discarded: z.number().optional(),
    discarded_autoruns: z.array(DiscardedAutorunSchema).optional(),
  })
  .passthrough()

export interface ApplyBody {
  readonly bundle: unknown
  readonly plugin_map: Record<string, { type: "engine" | "resolver"; id: number }>
  readonly removed_profiles?: string[]
  readonly removed_autoruns?: string[]
}
export function applyImport(body: ApplyBody): Promise<ImportApplySummary> {
  return apiFetch<unknown>("/import-export/apply", { body }).then((raw) =>
    parseOrWarn((value) => {
      const parsed = ApplySummarySchema.parse(value)
      const discarded = parsed.discarded_autoruns ?? []
      return {
        profiles_created: parsed.profiles_created ?? 0,
        profiles_skipped: parsed.profiles_skipped ?? 0,
        autoruns_created: parsed.autoruns_created ?? 0,
        autoruns_discarded: parsed.autoruns_discarded ?? discarded.length,
        discarded_autoruns: discarded,
      }
    }, raw),
  )
}

/* ── misc helpers ─────────────────────────────────────────────────── */
/** Authenticated JSON download (export endpoints). Returns false on failure. */
export function downloadJson(filename: string, data: unknown): boolean {
  try {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
    return true
  } catch {
    return false
  }
}

/** One HEAD probe per URL; only successes are retained (failures retry, hits are capped). */
const MAX_PROBE_CACHE = 500
const probeCache = new Map<string, Promise<boolean>>()
export function probeMediaUrl(url: string): Promise<boolean> {
  const cached = probeCache.get(url)
  if (cached !== undefined) return cached
  const probe = fetch(url, { method: "HEAD" })
    .then((response) => response.ok)
    .catch(() => false)
  probeCache.set(url, probe)
  void probe.then((ok) => {
    if (!ok) {
      probeCache.delete(url)
      return
    }
    if (probeCache.size > MAX_PROBE_CACHE) {
      const oldest = probeCache.keys().next().value
      if (oldest !== undefined) probeCache.delete(oldest)
    }
  })
  return probe
}

export function clearProbeCache(): void {
  probeCache.clear()
}
