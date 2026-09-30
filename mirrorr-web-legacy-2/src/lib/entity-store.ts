/**
 * The id-keyed entity store: the one place the client decides what a WS frame
 * or a mutation response does to the TanStack Query cache — and the one place
 * optimistic state lives, deliberately OUTSIDE that cache.
 *
 * Contract:
 * - `docs/web-frontend-spec.md` L165-L181 (frame handling) and L183-L189
 *   (cache reaction per subject);
 * - `docs/web-frontend-spec.md` L141-L150 (mutation optimism policy);
 * - `docs/general-client-specification.md` §13.10.10 (cross-client
 *   reconciliation) and §13.13 (never refetch a list you just optimistically
 *   updated; refetch only on `data == null` frames).
 *
 * The precedence itself is pure and lives in `entity-merge.ts`; this module
 * only routes frames/mutation responses to it and owns:
 *
 * - the per-id PENDING STORE. Optimistic state is an overlay record keyed by
 *   `resource:id` and is NEVER written into the entity cache. It is cleared by
 *   any authoritative snapshot for that id (the spec's "wait for the WS flip")
 *   and by `deleted` (which always wins);
 * - refetch coalescing: a data-less frame triggers exactly ONE in-flight
 *   refetch per `resource:id`, and writes no fields at all;
 * - tombstones: once `deleted` is applied, later snapshots for that id are
 *   ignored, so a racing `updated` frame cannot resurrect a deleted row;
 * - registration with `setOptimisticUpdateSource` (todo 7's seam), so a list
 *   that just received an optimistic update is not refetched (§13.13).
 *
 * Todo 18 owns the socket and todo 19 the event-subject wiring; both call
 * `applyFrame` / `applyMutationResponse` here instead of re-implementing
 * precedence.
 */
import type { InfiniteData, QueryClient, QueryKey } from "@tanstack/react-query"
import {
  mergeEntitySnapshot,
  removeEntityFromPages,
  upsertEntityInPages,
  type EntityPage,
  type EntityValues,
} from "@/lib/entity-merge"
import { setOptimisticUpdateSource } from "@/lib/optimistic-guard"
import { queryKeys } from "@/lib/query-keys"
import type { CursorPage } from "@/lib/schemas/pagination"

/** Every resource the entity store knows how to cache. */
export type EntityResource = "session" | "autorun" | "recording" | "profile" | "notification"

/** The WS event family prefix → resource. */
const RESOURCE_BY_EVENT_PREFIX: Readonly<Record<string, EntityResource>> = {
  session: "session",
  autorun: "autorun",
  recording: "recording",
  profile: "profile",
  notification: "notification",
}

/** The cursor-list query-key root of each resource (todo 7's key table). */
const LIST_ROOT: Readonly<Record<EntityResource, string>> = {
  session: "sessions",
  autorun: "autoruns",
  recording: "recordings",
  profile: "profiles",
  notification: "notifications",
}

/** The detail query key of the resources that have one (`recordings` has none). */
const DETAIL_KEY: Partial<Readonly<Record<EntityResource, (id: number) => QueryKey>>> = {
  session: (id) => queryKeys.session(id),
  autorun: (id) => queryKeys.autorun(id),
  profile: (id) => queryKeys.profile(id),
}

/**
 * One parsed `/ws/events` frame (todo 19 feeds these): `event` is the subject
 * (`session.updated`), `id` the routed entity id and `data` the authoritative
 * enriched entity when the server included it.
 */
export interface EntityFrame {
  readonly event: string
  readonly id: number
  readonly data?: EntityValues | null
}

/** Maps an event subject onto its resource; `null` for subjects we don't cache. */
export function resourceFromEvent(event: string): EntityResource | null {
  const prefix = event.split(".", 1)[0] ?? ""
  return RESOURCE_BY_EVENT_PREFIX[prefix] ?? null
}

export type PendingActionKind = "stop" | "recording-toggle" | "delete" | "mark-read"

/** The overlay state rendered INSTEAD of writing the entity cache. */
export interface PendingAction {
  readonly kind: PendingActionKind
  readonly resource: EntityResource
  readonly id: number
  readonly fields: Readonly<Record<string, unknown>> | undefined
}

/**
 * The handle a policy runner holds for one pending action. `cancelled` flips
 * when the entry was cleared by anything other than this ticket (an
 * authoritative snapshot, a `deleted` frame, or a superseding action), so late
 * error handling can stay silent.
 */
export interface PendingTicket {
  readonly cancelled: boolean
  readonly fields: Readonly<Record<string, unknown>> | undefined
  /** Removes the pending entry (idempotent). Returns false when already gone. */
  clear(): boolean
  /** Arms the repeating poll fallback; cleared with the entry. */
  schedulePollFallback(callback: () => void, intervalMs: number): void
}

interface PendingEntry {
  readonly kind: PendingActionKind
  readonly resource: EntityResource
  readonly id: number
  readonly fields: Readonly<Record<string, unknown>> | undefined
  timer: ReturnType<typeof setInterval> | null
  cleared: boolean
}

export interface EntityStoreOptions {
  readonly queryClient: QueryClient
  /**
   * How a data-less frame refetches `GET /{resource}/{id}`. Defaults to
   * refetching the matching detail query, or the resource's list queries for
   * resources without a detail key. Injectable so tests can count refetches.
   */
  readonly refetchEntity?: (resource: EntityResource, id: number) => Promise<void>
}

function entityKey(resource: EntityResource, id: number): string {
  return `${resource}:${id}`
}

function isCursorPage(value: unknown): value is CursorPage<EntityValues> {
  return (
    typeof value === "object" && value !== null && Array.isArray((value as { items?: unknown }).items)
  )
}

function isInfiniteEntityData(
  value: unknown,
): value is InfiniteData<CursorPage<EntityValues>, unknown> {
  if (typeof value !== "object" || value === null) return false
  const pages = (value as { pages?: unknown }).pages
  return Array.isArray(pages) && pages.every(isCursorPage)
}

export class EntityStore {
  private readonly queryClient: QueryClient
  private readonly refetchEntity: (resource: EntityResource, id: number) => Promise<void>
  private readonly pending = new Map<string, PendingEntry>()
  private readonly tombstones = new Set<string>()
  private readonly refetches = new Map<string, Promise<void>>()
  private readonly pendingListeners = new Set<() => void>()
  private readonly frameListeners = new Set<(frame: EntityFrame) => void>()

  constructor(options: EntityStoreOptions) {
    this.queryClient = options.queryClient
    this.refetchEntity = options.refetchEntity ?? this.defaultRefetch
  }

  /**
   * Observes every frame the store handles, after resource resolution. The
   * cache reaction stays owned by `applyFrame`; listeners only mirror it so a
   * view can raise its toast (todo 18 feeds the real frames here).
   */
  subscribeFrames(listener: (frame: EntityFrame) => void): () => void {
    this.frameListeners.add(listener)
    return () => {
      this.frameListeners.delete(listener)
    }
  }

  private emitFrames(frame: EntityFrame): void {
    for (const listener of this.frameListeners) listener(frame)
  }

  // -------------------------------------------------------------------------
  // Frame handling (todo 19 drives this; no view duplicates the precedence)
  // -------------------------------------------------------------------------

  /**
   * Applies one parsed WS frame. Resolves when a triggered refetch settles;
   * resolves immediately for snapshot/delete frames. Unknown subjects are
   * ignored (progress frames are routed elsewhere by todo 19).
   */
  applyFrame(frame: EntityFrame): Promise<void> {
    const resource = resourceFromEvent(frame.event)
    if (resource === null) return Promise.resolve()
    this.emitFrames(frame)

    if (frame.event.endsWith(".deleted")) {
      this.applyDeleted(resource, frame.id)
      return Promise.resolve()
    }

    if (frame.data === undefined || frame.data === null) {
      // Data-less frame: refetch exactly once, write NO fields (spec L165-L181).
      return this.scheduleRefetch(resource, frame.id)
    }

    this.applyAuthoritativeSnapshot(
      resource,
      frame.id,
      { ...frame.data, id: frame.id },
      { insert: frame.event.endsWith(".created") },
    )
    return Promise.resolve()
  }

  /**
   * An authoritative snapshot (WS `data`): field-by-field merge into the
   * cached detail entity and every cached list row, and clears that id's
   * pending overlay — this is the WS flip the optimistic policies wait for.
   */
  applyAuthoritativeSnapshot(
    resource: EntityResource,
    id: number,
    snapshot: EntityValues,
    options: { readonly insert: boolean } = { insert: false },
  ): void {
    if (this.tombstones.has(entityKey(resource, id))) return

    this.clearPending(resource, id)

    const detailKey = DETAIL_KEY[resource]?.(id)
    if (detailKey !== undefined) {
      const cached = this.queryClient.getQueryData<EntityValues>(detailKey)
      if (cached !== undefined) {
        this.queryClient.setQueryData(detailKey, mergeEntitySnapshot(cached, snapshot))
      }
    }

    this.updateListPages(resource, (pages) =>
      upsertEntityInPages(pages, snapshot, { insert: options.insert, insertOnly: false }),
    )
  }

  /**
   * An HTTP mutation response: INSERT ONLY UNKNOWN IDS. This is what makes a
   * create response and its WS echo one row in either arrival order.
   */
  applyMutationResponse(resource: EntityResource, entity: EntityValues): void {
    if (this.tombstones.has(entityKey(resource, entity.id))) return
    this.updateListPages(resource, (pages) =>
      upsertEntityInPages(pages, entity, { insert: true, insertOnly: true }),
    )
  }

  /**
   * `deleted` always wins: tombstone the id (a racing snapshot cannot
   * resurrect it), remove every cached copy, drop the detail cache and cancel
   * any pending action — including its poll fallback.
   */
  applyDeleted(resource: EntityResource, id: number): void {
    const key = entityKey(resource, id)
    this.tombstones.add(key)
    this.clearPending(resource, id)

    const detailKey = DETAIL_KEY[resource]?.(id)
    if (detailKey !== undefined) {
      this.queryClient.removeQueries({ queryKey: detailKey, exact: true })
    }

    this.updateListPages(resource, (pages) => removeEntityFromPages(pages, id))
  }

  // -------------------------------------------------------------------------
  // Refetch coalescing (data-less frames; the delete 15s fallback)
  // -------------------------------------------------------------------------

  /**
   * Refetches one entity at most once at a time: concurrent data-less frames
   * for the same id share the in-flight request (spec: "exactly one refetch").
   */
  scheduleRefetch(resource: EntityResource, id: number): Promise<void> {
    const key = entityKey(resource, id)
    const inFlight = this.refetches.get(key)
    if (inFlight !== undefined) return inFlight

    const request = this.runRefetch(resource, id).finally(() => {
      this.refetches.delete(key)
    })
    this.refetches.set(key, request)
    return request
  }

  private async runRefetch(resource: EntityResource, id: number): Promise<void> {
    try {
      await this.refetchEntity(resource, id)
    } catch {
      // The query layer owns retry/error UI; a failed refetch must not reject
      // the frame pump (todo 18).
    }
  }

  private readonly defaultRefetch = async (resource: EntityResource, id: number): Promise<void> => {
    const detailKey = DETAIL_KEY[resource]?.(id)
    if (detailKey !== undefined) {
      await this.queryClient.refetchQueries({ queryKey: detailKey, exact: true, type: "all" })
      return
    }
    await this.queryClient.refetchQueries({ queryKey: [LIST_ROOT[resource]], type: "all" })
  }

  // -------------------------------------------------------------------------
  // Pending / optimistic store (outside the entity cache, by design)
  // -------------------------------------------------------------------------

  /**
   * Opens (or supersedes) the pending action for one id. Optimistic field
   * values live here as an overlay; callers never write them to the cache.
   */
  beginPending(
    resource: EntityResource,
    id: number,
    request: { readonly kind: PendingActionKind; readonly fields?: Readonly<Record<string, unknown>> },
  ): PendingTicket {
    const key = entityKey(resource, id)
    this.clearEntry(this.pending.get(key))

    const entry: PendingEntry = {
      kind: request.kind,
      resource,
      id,
      fields: request.fields,
      timer: null,
      cleared: false,
    }
    this.pending.set(key, entry)
    this.emitPending()

    return {
      get cancelled() {
        return entry.cleared
      },
      get fields() {
        return entry.fields
      },
      clear: () => this.clearEntry(entry),
      schedulePollFallback: (callback, intervalMs) => {
        if (entry.cleared || entry.timer !== null) return
        entry.timer = setInterval(callback, intervalMs)
      },
    }
  }

  getPending(resource: EntityResource, id: number): PendingAction | undefined {
    const entry = this.pending.get(entityKey(resource, id))
    if (entry === undefined) return undefined
    return { kind: entry.kind, resource: entry.resource, id: entry.id, fields: entry.fields }
  }

  /** The optimistic overlay for one id; `undefined` when nothing is pending. */
  getPendingFields(resource: EntityResource, id: number): Readonly<Record<string, unknown>> | undefined {
    return this.pending.get(entityKey(resource, id))?.fields
  }

  subscribePending(listener: () => void): () => void {
    this.pendingListeners.add(listener)
    return () => {
      this.pendingListeners.delete(listener)
    }
  }

  /**
   * The `optimistic-guard` source (todo 7 seam, §13.13): a list with a pending
   * action for its resource must not be refetched on a data-less frame.
   * `listKey` is the serialized query key (`JSON.stringify(queryKeys.sessions())`)
   * or a bare resource root.
   */
  hasPendingForList(listKey: string): boolean {
    const root = listRootOf(listKey)
    if (root === null) return false
    for (const entry of this.pending.values()) {
      if (LIST_ROOT[entry.resource] === root) return true
    }
    return false
  }

  /** Registers this store with todo 7's seam; returns the uninstall. */
  installOptimisticUpdateSource(): () => void {
    setOptimisticUpdateSource((listKey) => this.hasPendingForList(listKey))
    return () => {
      setOptimisticUpdateSource(null)
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private clearPending(resource: EntityResource, id: number): boolean {
    return this.clearEntry(this.pending.get(entityKey(resource, id)))
  }

  private clearEntry(entry: PendingEntry | undefined): boolean {
    if (entry === undefined || entry.cleared) return false
    entry.cleared = true
    if (entry.timer !== null) {
      clearInterval(entry.timer)
      entry.timer = null
    }
    const key = entityKey(entry.resource, entry.id)
    if (this.pending.get(key) === entry) this.pending.delete(key)
    this.emitPending()
    return true
  }

  private emitPending(): void {
    for (const listener of this.pendingListeners) listener()
  }

  private updateListPages(
    resource: EntityResource,
    update: (pages: readonly EntityPage<EntityValues>[]) => readonly EntityPage<EntityValues>[],
  ): void {
    const queries = this.queryClient.getQueryCache().findAll({ queryKey: [LIST_ROOT[resource]] })
    for (const query of queries) {
      const data: unknown = query.state.data
      if (!isInfiniteEntityData(data)) continue

      const nextPages = update(data.pages.map((page) => page.items))
      const changed = nextPages.some((items, index) => items !== data.pages[index]?.items)
      if (!changed) continue

      const nextData: InfiniteData<CursorPage<EntityValues>, unknown> = {
        ...data,
        pages: data.pages.map((page, index) => ({ ...page, items: nextPages[index] ?? page.items })),
      }
      this.queryClient.setQueryData(query.queryKey, nextData)
    }
  }
}

/**
 * Reads the resource root out of a list key passed by the realtime layer:
 * either the serialized query key or the bare root string.
 */
function listRootOf(listKey: string): string | null {
  const trimmed = listKey.trim()
  if (trimmed.length === 0) return null
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (Array.isArray(parsed) && typeof parsed[0] === "string") return parsed[0]
    } catch {
      return null
    }
    return null
  }
  return trimmed
}
