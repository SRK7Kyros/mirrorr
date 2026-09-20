/**
 * The `/ws/events` subject→reaction table: the one place a raw entity frame is
 * parsed, routed and turned into a cache reaction (+ toast).
 *
 * Contract:
 * - `docs/web-frontend-spec.md` L165-L181 — frames are Zod-parsed loosely
 *   (`{type:"event", event:<subject>, id?, …hint fields, data?}`), `data` is
 *   authoritative when present, a data-less `updated/started/stopped/crashed`
 *   refetches `GET /{resource}/{id}` instead of writing fields, and the
 *   subject table's cache reaction is applied EXACTLY (no invented subjects);
 * - `docs/web-frontend-spec.md` L183-L189 — every write is an upsert by `id`,
 *   a `deleted` always removes, and a local mutation is provisional until the
 *   matching WS event lands (cross-client coherence);
 * - `docs/general-client-specification.md` §11.1 — the event catalog and the
 *   "prefer `payload.data`, treat top-level fields as hints" rule.
 *
 * Boundaries: `EntityStore` owns the merge precedence and toasts are raised
 * here through the todo-16 notification preferences. Remux progress
 * (`session.{id}.remux.progress`), the notification socket pipeline and the
 * polling cadences are todos 20/21 — this module exposes the seams and drops
 * nothing it does not own.
 */
import type { QueryClient } from "@tanstack/react-query"
import { z } from "zod"
import { type EntityValues } from "@/lib/entity-merge"
import type { EntityFrame, EntityStore } from "@/lib/entity-store"
import { readNotificationPrefs, type NotificationPrefs } from "@/lib/notification-policy"
import { queryKeys } from "@/lib/query-keys"
import { subscribeRealtimeFrames, type RealtimeFrame } from "@/lib/realtime-manager"
import { showToast, type ToastAction, type ToastTone } from "@/lib/toast"

/**
 * The spec's coalescing window (L169, §11.1 rule 4): frames landing inside one
 * 30ms window are deduped by `(event-family, id)` and only the newest applies.
 */
export const EVENT_COALESCE_MS = 30

/** The spec's event catalog: exactly these subjects, nothing else (L173-L181). */
export type EventResourceName = "session" | "autorun" | "recording" | "profile"
export type EventAction = "created" | "updated" | "deleted" | "started" | "stopped" | "crashed"

const SUBJECT_ACTIONS: Readonly<Record<EventResourceName, readonly EventAction[]>> = {
  session: ["created", "updated", "deleted", "started", "stopped", "crashed"],
  autorun: ["created", "updated", "deleted"],
  recording: ["created", "updated", "deleted"],
  profile: ["created", "updated", "deleted"],
}

/** One parsed, table-routed frame. `data` is the authoritative enriched entity. */
export interface ParsedEventFrame {
  readonly subject: string
  readonly resource: EventResourceName
  readonly action: EventAction
  readonly id: number
  readonly data: Readonly<Record<string, unknown>> | null
}

/**
 * Loose frame parsing: unknown/extra keys are tolerated (`passthrough`), a
 * malformed frame is rejected as `null` and never throws into the pump. The
 * `type` key is a hint — the relay does not set it on `/ws/events` frames.
 */
export function parseEventFrame(payload: unknown): ParsedEventFrame | null {
  const parsed = eventFrameSchema.safeParse(payload)
  if (!parsed.success) return null

  const { event, data } = parsed.data
  const subject = parseEventSubject(event)
  if (subject === null) return null

  const id = resolveFrameId(parsed.data.id, data ?? null)
  if (id === null) return null

  return { subject: event, resource: subject.resource, action: subject.action, id, data: data ?? null }
}

const entityDataSchema = z.custom<Readonly<Record<string, unknown>>>(
  (value) => typeof value === "object" && value !== null && !Array.isArray(value),
)

const eventFrameSchema = z
  .object({
    event: z.string(),
    id: z.number().int().nullish(),
    data: entityDataSchema.nullish(),
  })
  .passthrough()

interface ParsedEventSubject {
  readonly resource: EventResourceName
  readonly action: EventAction
}

function parseEventSubject(subject: string): ParsedEventSubject | null {
  const segments = subject.split(".")
  if (segments.length !== 2) return null
  const [family, action] = segments
  if (family === undefined || action === undefined) return null
  if (!isEventResource(family) || !isEventAction(action)) return null
  if (!SUBJECT_ACTIONS[family].includes(action)) return null
  return { resource: family, action }
}

/** The coalescing identity: one family+id may only apply once per flush (L169). */
export function eventCoalesceKey(frame: ParsedEventFrame): string {
  return `${frame.resource}:${frame.id}`
}

export interface EventToastSpec {
  readonly message: string
  readonly tone: ToastTone
  readonly action?: ToastAction
}

export interface EventTableOptions {
  readonly store: EntityStore
  readonly queryClient: QueryClient
  /** The router surface for `deleted` frames addressed to an OPEN detail. */
  readonly navigate: (path: "/sessions" | "/autoruns") => void
  /** True when that resource's detail route is currently mounted. */
  readonly isDetailOpen: (resource: "session" | "autorun", id: number) => boolean
  /** `nameMapStore.invalidateForEvent` — profile frames invalidate the memo map. */
  readonly invalidateNamesForEvent: (eventType: string) => unknown
  /** Defaults to the todo-16 persisted preferences. */
  readonly readPrefs?: () => NotificationPrefs
  /** Overridable for tests; defaults to the spec's 30ms window. */
  readonly coalesceMs?: number
}

type ResolvedOptions = EventTableOptions & { readonly readPrefs: () => NotificationPrefs }

interface ListPage {
  readonly items: readonly EntityValues[]
}

interface InfiniteDataLike {
  readonly pages: readonly ListPage[]
}

function isEventResource(value: string): value is EventResourceName {
  return value === "session" || value === "autorun" || value === "recording" || value === "profile"
}

function isEventAction(value: string): value is EventAction {
  return (
    value === "created" ||
    value === "updated" ||
    value === "deleted" ||
    value === "started" ||
    value === "stopped" ||
    value === "crashed"
  )
}

function resolveFrameId(rawId: unknown, data: Readonly<Record<string, unknown>> | null): number | null {
  if (typeof rawId === "number" && Number.isInteger(rawId)) return rawId
  const dataId = data?.id
  if (typeof dataId === "number" && Number.isInteger(dataId)) return dataId
  return null
}

function stringField(record: Readonly<Record<string, unknown>> | null, key: string): string | null {
  const value = record?.[key]
  return typeof value === "string" ? value : null
}

function numberField(record: Readonly<Record<string, unknown>> | null, key: string): number | null {
  const value = record?.[key]
  return typeof value === "number" && Number.isInteger(value) ? value : null
}

function isInfiniteDataLike(value: unknown): value is InfiniteDataLike {
  if (typeof value !== "object" || value === null) return false
  const pages = (value as { pages?: unknown }).pages
  return Array.isArray(pages) && pages.every((page) => typeof page === "object" && page !== null && Array.isArray((page as ListPage).items))
}

/** The record a `session.created` frame is expected to have spawned. */
function autorunNameFromCache(queryClient: QueryClient, autorunId: number): string | null {
  const detail = queryClient.getQueryData<EntityValues>(queryKeys.autorun(autorunId))
  const direct = detail === undefined ? null : stringField(detail, "user_friendly_name")
  if (direct !== null) return direct

  for (const query of queryClient.getQueryCache().findAll({ queryKey: queryKeys.autorunsAll() })) {
    const data: unknown = query.state.data
    if (!isInfiniteDataLike(data)) continue
    for (const page of data.pages) {
      for (const row of page.items) {
        if (row.id !== autorunId) continue
        const name = stringField(row, "user_friendly_name")
        if (name !== null) return name
      }
    }
  }
  return null
}

export class EventTable {
  private readonly options: ResolvedOptions
  private readonly store: EntityStore
  private readonly buffer = new Map<string, ParsedEventFrame>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: EventTableOptions) {
    this.options = { ...options, readPrefs: options.readPrefs ?? (() => readNotificationPrefs()) }
    this.store = options.store
  }

  /**
   * Parses one raw `/ws/events` payload and buffers it until the coalescing
   * window closes. Returns `false` for malformed frames and subjects outside
   * the catalog; never throws.
   */
  handlePayload(payload: unknown): boolean {
    const frame = parseEventFrame(payload)
    if (frame === null) return false
    this.buffer.set(eventCoalesceKey(frame), frame)
    this.scheduleFlush()
    return true
  }

  /** Applies every buffered frame now (tests, teardown); newest-wins per key. */
  flushNow(): void {
    this.cancelFlush()
    if (this.buffer.size === 0) return
    const frames = [...this.buffer.values()]
    this.buffer.clear()
    for (const frame of frames) this.dispatch(frame)
  }

  /** Drops buffered frames and cancels the pending flush. */
  dispose(): void {
    this.cancelFlush()
    this.buffer.clear()
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flushNow()
    }, this.options.coalesceMs ?? EVENT_COALESCE_MS)
  }

  private cancelFlush(): void {
    if (this.flushTimer === null) return
    clearTimeout(this.flushTimer)
    this.flushTimer = null
  }

  /** Applies one already-parsed frame's cache reaction (+ toast) exactly. */
  dispatch(frame: ParsedEventFrame): void {
    switch (frame.subject) {
      case "session.created":
        this.store.applyFrame(toEntityFrame(frame))
        this.patchSpawningAutorun(frame)
        this.raise(frame)
        return
      case "session.updated":
        this.store.applyFrame(toEntityFrame(frame))
        this.raise(frame)
        return
      case "session.started":
      case "session.stopped":
        this.store.applyFrame(toEntityFrame(frame))
        return
      case "session.crashed":
        this.store.applyFrame(toEntityFrame(frame))
        if (frame.data !== null) this.refetchCachedDetail("session", frame.id)
        this.raise(frame)
        return
      case "session.deleted":
        this.applyDeletedWithNavigation(frame)
        return
      case "autorun.created":
      case "autorun.updated":
        this.store.applyFrame(toEntityFrame(frame))
        return
      case "autorun.deleted":
        this.applyDeletedWithNavigation(frame)
        return
      case "recording.created":
        // Spec L183: invalidate the family; the refetch is the insert.
        void this.options.queryClient.invalidateQueries({ queryKey: queryKeys.recordingsAll() })
        this.raise(frame)
        return
      case "recording.updated":
      case "recording.deleted":
        this.store.applyFrame(toEntityFrame(frame))
        return
      case "profile.created":
      case "profile.updated":
      case "profile.deleted":
        void this.options.queryClient.invalidateQueries({ queryKey: queryKeys.profilesAll() })
        this.options.invalidateNamesForEvent(frame.subject)
        return
      default:
        return
    }
  }

  /**
   * The spec's toast column, mapped onto the user-configurable categories of
   * `notification-policy.ts`. Only the four spec'd events can toast; a
   * `null` spec is silence. Prefs are read once per frame (Settings writes
   * localStorage, so the next frame sees the new value).
   */
  private toastSpecFor(frame: ParsedEventFrame, prefs: NotificationPrefs): EventToastSpec | null {
    switch (frame.subject) {
      case "session.created": {
        const autorunId = numberField(frame.data, "autorun_id")
        if (autorunId === null) return null
        const name = autorunNameFromCache(this.options.queryClient, autorunId) ?? `#${autorunId}`
        return { message: `Autorun '${name}' started`, tone: "info" }
      }
      case "session.updated":
        // "Status→completed" (L177) is the only configurable frame-table toast.
        return stringField(frame.data, "status") === "completed" && prefs.completions
          ? { message: `Session #${frame.id} completed`, tone: "info" }
          : null
      case "session.crashed":
        return prefs.crashes
          ? { message: `Session #${frame.id} failed`, tone: "error" }
          : null
      case "recording.created":
        return prefs.recordings
          ? {
              message: "Recording saved",
              tone: "info",
              action: { label: "Open", href: `/recordings?highlight=${frame.id}` },
            }
          : null
      default:
        return null
    }
  }

  private raise(frame: ParsedEventFrame): void {
    const spec = this.toastSpecFor(frame, this.options.readPrefs())
    if (spec !== null) showToast(spec.message, spec.tone, spec.action)
  }

  /**
   * `session.created` + `autorun_id`: the spawned session's status is the
   * lifecycle the autorun row mirrors, so patch the cached row in place
   * (spec L175). Unknown/inserted rows are left alone.
   */
  private patchSpawningAutorun(frame: ParsedEventFrame): void {
    const autorunId = numberField(frame.data, "autorun_id")
    if (autorunId === null) return
    const status = stringField(frame.data, "status")
    const snapshot: EntityValues =
      status === null ? { id: autorunId } : { id: autorunId, status }
    this.options.store.applyAuthoritativeSnapshot("autorun", autorunId, snapshot, { insert: false })
  }

  /** Spec L179/L181: remove from every cache and, if open, leave the detail. */
  private applyDeletedWithNavigation(frame: ParsedEventFrame): void {
    const resource = frame.resource === "autorun" ? "autorun" : "session"
    const open = this.options.isDetailOpen(resource, frame.id)
    this.store.applyFrame(toEntityFrame(frame))
    if (open) this.options.navigate(resource === "session" ? "/sessions" : "/autoruns")
  }

  /** "Patch + refetch detail if open" (L178): only a cached detail is refetched. */
  private refetchCachedDetail(resource: "session" | "autorun" | "profile", id: number): void {
    const key = queryKeys[resource](id)
    if (this.options.queryClient.getQueryData(key) === undefined) return
    void this.options.queryClient.refetchQueries({ queryKey: key, exact: true, type: "all" })
  }
}

function toEntityFrame(frame: ParsedEventFrame): EntityFrame {
  return frame.data === null
    ? { event: frame.subject, id: frame.id }
    : { event: frame.subject, id: frame.id, data: { ...frame.data, id: frame.id } }
}

export interface InstallEventTableOptions extends EventTableOptions {
  /** Overridable for tests; defaults to the real `realtime-manager` frame bus. */
  readonly subscribe?: (listener: (frame: RealtimeFrame) => void) => () => void
}

/**
 * Subscribes the table to the raw frame bus (`subscribeRealtimeFrames`) and
 * returns the teardown. Notification-role frames stay untouched — the
 * `/ws/notifications` pipeline (drawer, badge, flush) is todo 20.
 */
export function installEventTable(options: InstallEventTableOptions): () => void {
  const table = new EventTable(options)
  const subscribe = options.subscribe ?? subscribeRealtimeFrames
  const unsubscribe = subscribe((frame) => {
    if (frame.role !== "events") return
    table.handlePayload(frame.payload)
  })
  return () => {
    unsubscribe()
    table.dispose()
  }
}

