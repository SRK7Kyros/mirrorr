/**
 * The `id→name` memo map.
 *
 * Contract: `docs/general-client-specification.md` §13.13 — "Local memoized
 * map: on first `GET /engines/` + `/resolvers/` + `/profiles/`, build
 * `id→name`; invalidate on WS `*.updated/deleted`" (saves N×3 requests → one
 * per collection).
 *
 * The store is transport-free: it loads through an injected loader, memoizes
 * one in-flight/settled load per kind, and exposes a `useSyncExternalStore`
 * compatible `subscribe`/`getSnapshot` pair. `src/lib/name-map-api.ts` wires
 * the real API loader; the realtime manager (todo 18) calls
 * `invalidateForEvent()` with the raw WS event type.
 */

/** The three name sources the cheat-sheet lists. */
export type NameMapKind = "engine" | "resolver" | "profile"

/** The minimum a catalog row needs to contribute a name. */
export interface NameMapEntity {
  readonly id: number
  readonly name: string
}

/** Loads every named entity of one kind (all pages) — exactly once per load. */
export type NameMapLoader = (kind: NameMapKind) => Promise<readonly NameMapEntity[]>

/** Immutable snapshot handed to `useSyncExternalStore`. */
export interface NameMapState {
  readonly version: number
  readonly maps: Readonly<Record<NameMapKind, ReadonlyMap<number, string>>>
}

export interface NameMapStore {
  /** Loads the kind once (single-flight); a resolved kind is a no-op. */
  readonly ensure: (kind: NameMapKind) => Promise<void>
  /** Synchronous lookup; `undefined` means "not loaded yet / unknown id". */
  readonly get: (kind: NameMapKind, id: number) => string | undefined
  /** Drops a kind's map so the next `ensure` refetches it. */
  readonly invalidate: (kind: NameMapKind) => void
  /**
   * The WS seam: maps an event type (`engine.updated`, `profile.deleted`, …)
   * to its name-map kind, invalidates it, and kicks a single refetch. Returns
   * the kind, or `null` when the event does not touch the name map.
   */
  readonly invalidateForEvent: (eventType: string) => NameMapKind | null
  readonly subscribe: (listener: () => void) => () => void
  readonly getSnapshot: () => NameMapState
}

/** Maps a WS event type onto the name-map kind it invalidates. */
export function nameMapKindForEvent(eventType: string): NameMapKind | null {
  const family = eventType.split(".", 1)[0]
  return family === "engine" || family === "resolver" || family === "profile" ? family : null
}

function emptyMaps(): Record<NameMapKind, ReadonlyMap<number, string>> {
  return { engine: new Map(), resolver: new Map(), profile: new Map() }
}

export function createNameMapStore(load: NameMapLoader): NameMapStore {
  const listeners = new Set<() => void>()
  const loadedKinds = new Set<NameMapKind>()
  const inFlight = new Map<NameMapKind, Promise<void>>()
  let snapshot: NameMapState = { version: 0, maps: emptyMaps() }

  const notify = (): void => {
    for (const listener of listeners) listener()
  }

  const setEntities = (kind: NameMapKind, entities: readonly NameMapEntity[]): void => {
    const next = new Map<number, string>()
    for (const entity of entities) next.set(entity.id, entity.name)
    snapshot = { version: snapshot.version + 1, maps: { ...snapshot.maps, [kind]: next } }
    loadedKinds.add(kind)
    notify()
  }

  const ensure = (kind: NameMapKind): Promise<void> => {
    if (loadedKinds.has(kind)) return Promise.resolve()

    const running = inFlight.get(kind)
    if (running !== undefined) return running

    const request = load(kind).then(
      (entities) => {
        inFlight.delete(kind)
        setEntities(kind, entities)
      },
      (error: unknown) => {
        // A failed load is not remembered: the next ensure retries.
        inFlight.delete(kind)
        throw error
      },
    )
    inFlight.set(kind, request)
    return request
  }

  const invalidate = (kind: NameMapKind): void => {
    loadedKinds.delete(kind)
    snapshot = { version: snapshot.version + 1, maps: { ...snapshot.maps, [kind]: new Map() } }
    notify()
  }

  const invalidateForEvent = (eventType: string): NameMapKind | null => {
    const kind = nameMapKindForEvent(eventType)
    if (kind === null) return null
    invalidate(kind)
    // One coalesced refetch per kind; failures are retried by a later ensure.
    void ensure(kind).catch(() => undefined)
    return kind
  }

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  return {
    ensure,
    get: (kind, id) => snapshot.maps[kind].get(id),
    invalidate,
    invalidateForEvent,
    subscribe,
    getSnapshot: () => snapshot,
  }
}
