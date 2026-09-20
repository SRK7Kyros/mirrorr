/**
 * Re-renders a view whenever any pending store entry changes, so row-level
 * "Deleting…"/"Stopping…" affordances stay in sync with the pending overlay.
 */
import { useEffect, useState } from "react"
import type { EntityStore } from "@/lib/entity-store"

export function useStorePendingVersion(store: EntityStore): number {
  const [version, setVersion] = useState(0)
  useEffect(() => store.subscribePending(() => setVersion((value) => value + 1)), [store])
  return version
}
