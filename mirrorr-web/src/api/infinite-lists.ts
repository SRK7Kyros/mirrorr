import type { InfiniteData, QueryClient } from "@tanstack/react-query"
import { clearPendingActions, type EntityId, type Identified } from "@/api/entity-store"
import type { CursorPage } from "@/api/query-keys"

/**
 * Rule 5 across every cached page of a cursor list: drop the id from each page
 * and cancel its pending actions. One implementation, shared by view mutations
 * and the realtime event table.
 */
export function removeFromInfiniteLists(
  client: QueryClient,
  root: readonly unknown[],
  id: EntityId,
): void {
  clearPendingActions(id)
  client.setQueriesData<InfiniteData<CursorPage<Identified>>>({ queryKey: root }, (previous) => {
    if (previous === undefined) return undefined
    return {
      ...previous,
      pages: previous.pages.map((page) => ({
        ...page,
        items: page.items.filter((item) => item.id !== id),
      })),
    }
  })
}
