/**
 * The app-level entity store singleton.
 *
 * Wave 1 ships `EntityStore` as a class (`src/lib/entity-store.ts`); this
 * module owns the one instance bound to the app query client and installs it
 * as the optimistic-update source so the mutation policies in
 * `src/lib/optimistic-policy.ts` can publish pending overlays.
 *
 * Real sockets arrive in Wave 3 (todo 18); until then `applyFrame` is exercised
 * by the unit tests and the store still owns pending state, list patching and
 * the delete poll fallback.
 */
import { EntityStore } from "@/lib/entity-store"
import { queryClient } from "@/query-client"

export const entityStore = new EntityStore({ queryClient })

entityStore.installOptimisticUpdateSource()
