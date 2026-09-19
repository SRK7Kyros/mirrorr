/**
 * React binding for the `id→name` memo map.
 *
 * Mounting resolves the three catalogs through the singleton store (one fetch
 * per kind); the returned `nameFor` is synchronous and returns `undefined`
 * until a name is known — the caller renders a muted `#<id>` fallback.
 * `invalidateNames` is the seam the realtime manager (todo 18) calls; it can
 * also use `nameMapStore.invalidateForEvent(event.event)` for raw WS events.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react"
import type { NameMapKind, NameMapState } from "@/lib/name-map"
import { nameMapStore } from "@/lib/name-map-api"

export interface NameResolver {
  readonly nameFor: (kind: NameMapKind, id: number | null | undefined) => string | undefined
  readonly invalidateNames: (kind: NameMapKind) => void
}

const NAME_MAP_KINDS: readonly NameMapKind[] = ["engine", "resolver", "profile"]

export function useNameMap(): NameResolver {
  const state: NameMapState = useSyncExternalStore(nameMapStore.subscribe, nameMapStore.getSnapshot)

  useEffect(() => {
    for (const kind of NAME_MAP_KINDS) {
      // Failures leave the map empty; ids render their #<id> fallback and a
      // later mount/ensure retries.
      void nameMapStore.ensure(kind).catch(() => undefined)
    }
  }, [])

  const nameFor = useCallback(
    (kind: NameMapKind, id: number | null | undefined) =>
      id === null || id === undefined ? undefined : state.maps[kind].get(id),
    [state],
  )

  return { nameFor, invalidateNames: nameMapStore.invalidate }
}
