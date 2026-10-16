import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { fetchResourceAccess, fetchUsers, getErrorMessage } from "@/api"
import {
  applyPlans,
  emptyGrants,
  itemAccessFromView,
  planItem,
  type AccessTarget,
  type ItemAccess,
} from "@/api/domain/access-plan"
import { queryKeys, queryRoots, staleTimes } from "@/api/query-keys"
import type { ResourceType } from "@/api/schemas/privileged"
import { Button, Dialog, ErrorPanel, SkeletonRows, toast } from "@/ui/components"
import { ResourceAccessEditor, resourceTypeLabel, useAccessDraft } from "./resource-access"

const EMPTY_ACCESS: ItemAccess = { owner: null, ownerMissing: false, grants: emptyGrants() }

export interface AccessPanelProps {
  readonly resourceType: ResourceType
  readonly id: number
  readonly label: string
  readonly onClose: () => void
}

/**
 * The one access affordance: a centered floating modal for every pointer type
 * (a `Dialog`, never an edge-docked sheet). It owns the access read and the
 * catalog, drafts locally through `useAccessDraft`, and writes only on Apply —
 * the replace-set fan-out is `applyPlans` over the per-item routes. The editor
 * body is shared with the settings dialog so the two surfaces cannot drift.
 */
export function AccessPanel({ resourceType, id, label, onClose }: AccessPanelProps) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)

  const usersQuery = useQuery({ queryKey: queryKeys.users, queryFn: fetchUsers, staleTime: staleTimes.users })
  const accessQuery = useQuery({
    queryKey: queryKeys.adminResourceAccess(resourceType, id),
    queryFn: () => fetchResourceAccess(resourceType, id),
    staleTime: staleTimes.adminResources,
  })

  const users = usersQuery.data ?? []
  const loaded =
    accessQuery.data !== undefined && !accessQuery.isLoading && !usersQuery.isLoading && !accessQuery.isError
  const access = accessQuery.data === undefined ? EMPTY_ACCESS : itemAccessFromView(accessQuery.data)
  const draft = useAccessDraft(access)

  async function apply(target: AccessTarget): Promise<void> {
    const view = accessQuery.data
    if (view === undefined) return
    setBusy(true)
    const outcome = await applyPlans([
      planItem(
        { resourceType, id, label, access: itemAccessFromView(view) },
        target,
        users.map((user) => user.username),
      ),
    ])
    // Keep the panel busy until the read lands, so the next edit drafts against
    // the server state rather than a stale base (a no-op diff that looks saved).
    await queryClient.invalidateQueries({ queryKey: queryRoots.adminResources })
    await queryClient.invalidateQueries({ queryKey: queryKeys.adminResourceAccess(resourceType, id) })
    setBusy(false)
    if (outcome.failed.length > 0) toast.error("Could not update access", outcome.failed[0].message)
    else toast.success("Access updated", label)
  }

  return (
    <Dialog
      open
      onClose={onClose}
      busy={busy}
      size="xl"
      title={`Access · ${label}`}
      description={`${resourceTypeLabel(resourceType)} · #${id}`}
      footer={
        loaded ? (
          <div className="flex w-full items-center justify-between gap-3">
            <span className="text-sm text-muted">{draft.dirty ? "Unsaved changes" : "Up to date"}</span>
            <Button
              variant="primary"
              loading={busy}
              disabled={!draft.dirty || busy}
              onClick={() => void apply(draft.target)}
            >
              Apply changes
            </Button>
          </div>
        ) : null
      }
    >
      {accessQuery.isLoading || usersQuery.isLoading ? (
        <SkeletonRows rows={4} cols={2} />
      ) : accessQuery.isError ? (
        <ErrorPanel
          message={getErrorMessage(accessQuery.error, "Could not load access")}
          onRetry={() => void accessQuery.refetch()}
        />
      ) : accessQuery.data === undefined ? (
        <SkeletonRows rows={4} cols={2} />
      ) : (
        <ResourceAccessEditor resourceType={resourceType} draft={draft} users={users} busy={busy} />
      )}
    </Dialog>
  )
}
