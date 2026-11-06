import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { fetchAdminResources, fetchGroups, fetchResourceAccess, fetchUsers } from "@/api"
import { applyPlans, itemAccessFromView, planItem, type AccessTarget } from "@/api/domain/access-plan"
import { rankBySearch } from "@/api/domain/search"
import { PAGE_SIZE, queryKeys, queryRoots, staleTimes } from "@/api/query-keys"
import { RESOURCE_TYPES, type AdminResource } from "@/api/schemas/privileged"
import type { User } from "@/api/schemas/user"
import {
  Button,
  Dialog,
  EmptyState,
  PageToolbar,
  Panel,
  PanelBody,
  PanelHead,
  QueryState,
  RowActions,
  Select,
  SkeletonRows,
  StatLine,
  Table,
  Tag,
  Td,
  Th,
  toast,
} from "@/ui/components"
import { ResourceAccessFields, resourceTypeLabel, userLabel } from "@/ui/views/shared/resource-access"
import { AdminSearch } from "./admin-search"
import { countLabel } from "./format"

/** "3 viewers · 1 group" — the access column's summary of user and group grants. */
function accessSummary(resource: AdminResource): string {
  const viewers = countLabel(resource.viewer_count, "viewer")
  const groups = resource.grant_groups.length
  if (groups === 0) return viewers
  return `${viewers} · ${countLabel(groups, "group")}`
}

/**
 * Admin resource browser (plan: admin-ownership-and-access). One offset page of
 * every item — owner-bearing rows plus engines/resolvers as read-only system
 * rows. There is no server-side free-text search, so a term ranks the loaded
 * page client-side through the same `rankBySearch` the lists use.
 */
export function ResourceAccessPanel() {
  const [typeFilter, setTypeFilter] = useState("")
  const [ownerFilter, setOwnerFilter] = useState("")
  const [search, setSearch] = useState("")
  const [offset, setOffset] = useState(0)
  const [target, setTarget] = useState<AdminResource | null>(null)

  const usersQuery = useQuery({ queryKey: queryKeys.users, queryFn: fetchUsers, staleTime: staleTimes.users })

  const query = useMemo(
    () => ({
      resource_type: typeFilter === "" ? undefined : typeFilter,
      owner: ownerFilter === "" ? undefined : ownerFilter,
      limit: PAGE_SIZE,
      offset,
    }),
    [typeFilter, ownerFilter, offset],
  )

  const resourcesQuery = useQuery({
    queryKey: queryKeys.adminResources(query),
    queryFn: () => fetchAdminResources(query),
    staleTime: staleTimes.adminResources,
  })

  const users = usersQuery.data ?? []
  const page = resourcesQuery.data
  const items = page?.items ?? []
  const rows = useMemo(
    () => (search.trim() === "" ? items : rankBySearch(items, search, (item) => [item.label, item.owner])),
    [items, search],
  )
  const total = page?.total ?? 0

  const filtered = typeFilter !== "" || ownerFilter !== "" || search.trim() !== ""
  const empty =
    total === 0 && !filtered ? (
      <EmptyState
        title="No resources"
        text="Sessions, profiles, autoruns, recordings and sources appear here once they exist."
      />
    ) : (
      <EmptyState
        title="Nothing matches these filters"
        text="Clear the search box or reset the type and owner filters."
      />
    )

  return (
    <Panel>
      <PanelHead title="Resource access" />
      <PanelBody flush className="flex flex-col gap-2 border-b border-line-subtle p-3">
        <PageToolbar
          filters={
            <>
              <Select
                aria-label="Filter by resource type"
                value={typeFilter}
                onChange={(event) => {
                  setTypeFilter(event.target.value)
                  setOffset(0)
                }}
              >
                <option value="">All types</option>
                {RESOURCE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {resourceTypeLabel(type)}
                  </option>
                ))}
              </Select>
              <Select
                aria-label="Filter by owner"
                value={ownerFilter}
                onChange={(event) => {
                  setOwnerFilter(event.target.value)
                  setOffset(0)
                }}
              >
                <option value="">All owners</option>
                {users.map((user) => (
                  <option key={user.username} value={user.username}>
                    {userLabel(user)}
                  </option>
                ))}
              </Select>
            </>
          }
          search={
            <AdminSearch
              value={search}
              onChange={setSearch}
              label="Filter resources"
              placeholder="Filter this page…"
            />
          }
        />
        <StatLine
          label="Resource counts"
          items={[
            countLabel(total, "resource"),
            ...(total > PAGE_SIZE
              ? [`Showing ${offset + 1}–${Math.min(offset + PAGE_SIZE, total)}`]
              : []),
          ]}
        />
      </PanelBody>
      <PanelBody flush>
        <div className="p-3">
          <QueryState
            query={resourcesQuery}
            loading={<SkeletonRows cols={4} />}
            isEmpty={rows.length === 0}
            empty={empty}
            errorMessage="Could not load resources"
          >
            <div className="hidden min-[672px]:block">
              <Table>
                <thead>
                  <tr>
                    <Th>Resource</Th>
                    <Th>Type</Th>
                    <Th>Owner</Th>
                    <Th>Access</Th>
                    <Th className="cell-actions">
                      <span className="sr-only">Actions</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((resource) => (
                    <tr key={`${resource.resource_type}-${resource.id}`}>
                      <Td>{resource.label}</Td>
                      <Td className="text-ink-muted">{resourceTypeLabel(resource.resource_type)}</Td>
                      <Td>
                        <OwnerCell resource={resource} />
                      </Td>
                      <Td className="text-ink-muted">{accessSummary(resource)}</Td>
                      <Td actions>
                        {resource.system ? null : (
                          <RowActions
                            label={`Actions for ${resource.label}`}
                            actions={[{ label: "Manage access", onSelect: () => setTarget(resource) }]}
                          />
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <ul className="flex flex-col divide-y divide-line-subtle min-[672px]:hidden">
              {rows.map((resource) => (
                <li
                  key={`${resource.resource_type}-${resource.id}`}
                  className="flex items-start justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-base font-medium text-ink">{resource.label}</div>
                    <div className="text-xs text-ink-dim">{resourceTypeLabel(resource.resource_type)}</div>
                    <div className="mt-1 text-sm text-ink-muted">
                      <OwnerCell resource={resource} />
                    </div>
                    <div className="mt-1 text-sm text-ink-muted">{accessSummary(resource)}</div>
                  </div>
                  {resource.system ? null : (
                    <RowActions
                      label={`Actions for ${resource.label}`}
                      actions={[{ label: "Manage access", onSelect: () => setTarget(resource) }]}
                    />
                  )}
                </li>
              ))}
            </ul>

            {total > PAGE_SIZE ? (
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-ink-muted">
                  {`Showing ${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} of ${total}`}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={offset + PAGE_SIZE >= total}
                    onClick={() => setOffset(offset + PAGE_SIZE)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </QueryState>
        </div>
      </PanelBody>

      {target !== null ? (
        <ResourceAccessDialog resource={target} users={users} onClose={() => setTarget(null)} />
      ) : null}
    </Panel>
  )
}

function OwnerCell({ resource }: { readonly resource: AdminResource }) {
  if (resource.system) return <Tag>System</Tag>
  return (
    <div className="flex flex-col gap-0.5">
      {resource.owner_missing ? (
        <span className="text-danger">{resource.owner} (missing)</span>
      ) : (
        <span>{resource.owner}</span>
      )}
      {resource.owner_groups.length > 0 ? (
        <span className="text-xs text-ink-dim">{`Owner groups: ${resource.owner_groups.join(", ")}`}</span>
      ) : null}
    </div>
  )
}

interface ResourceAccessDialogProps {
  readonly resource: AdminResource
  readonly users: readonly User[]
  readonly onClose: () => void
}

function ResourceAccessDialog({ resource, users, onClose }: ResourceAccessDialogProps) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)

  const groupsQuery = useQuery({ queryKey: queryKeys.groups, queryFn: fetchGroups, staleTime: staleTimes.users })
  const accessQuery = useQuery({
    queryKey: queryKeys.adminResourceAccess(resource.resource_type, resource.id),
    queryFn: () => fetchResourceAccess(resource.resource_type, resource.id),
    staleTime: staleTimes.adminResources,
  })
  const access = accessQuery.data

  async function apply(target: AccessTarget): Promise<void> {
    if (access === undefined) return
    setBusy(true)
    const outcome = await applyPlans([
      planItem(
        {
          resourceType: resource.resource_type,
          id: resource.id,
          label: resource.label,
          access: itemAccessFromView(access),
        },
        target,
        users.map((user) => user.username),
      ),
    ])
    setBusy(false)
    void queryClient.invalidateQueries({ queryKey: queryRoots.adminResources })
    void queryClient.invalidateQueries({
      queryKey: queryKeys.adminResourceAccess(resource.resource_type, resource.id),
    })
    if (outcome.failed.length > 0) toast.error("Could not update access", outcome.failed[0].message)
    else toast.success("Access updated", resource.label)
  }

  return (
    <Dialog
      open
      onClose={onClose}
      busy={busy}
      size="xl"
      title={`Access · ${resource.label}`}
      description={`${resourceTypeLabel(resource.resource_type)} · #${resource.id}`}
      footer={
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Close
        </Button>
      }
    >
      <QueryState query={accessQuery} loading={<SkeletonRows cols={2} />} errorMessage="Could not load access">
        {access === undefined ? (
          <SkeletonRows cols={2} />
        ) : (
          <ResourceAccessFields
            resourceType={resource.resource_type}
            access={itemAccessFromView(access)}
            users={users}
            groups={groupsQuery.data?.items ?? []}
            busy={busy}
            onApply={(target) => void apply(target)}
          />
        )}
      </QueryState>
    </Dialog>
  )
}
