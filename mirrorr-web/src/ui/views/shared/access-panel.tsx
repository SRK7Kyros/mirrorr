import { useId, useMemo, useState, type ReactNode } from "react"
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
import { rankBySearch } from "@/api/domain/search"
import { queryKeys, queryRoots, staleTimes } from "@/api/query-keys"
import { CAPABILITIES, type ResourceType } from "@/api/schemas/privileged"
import type { User } from "@/api/schemas/user"
import { Avatar, Button, Dialog, ErrorPanel, Input, SkeletonRows, toast } from "@/ui/components"
import { IconCheck, IconSearch } from "@/ui/components/icons"
import { cn } from "@/ui/lib/cn"
import {
  capabilityLabel,
  ownerOptions,
  resourceTypeLabel,
  useAccessDraft,
  userLabel,
  type AccessDraft,
} from "./resource-access"

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
 * the replace-set fan-out is `applyPlans` over the per-item routes.
 */
export function AccessPanel({ resourceType, id, label, onClose }: AccessPanelProps) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState("")

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
        <AccessPanelBody draft={draft} query={query} setQuery={setQuery} users={users} busy={busy} />
      )}
    </Dialog>
  )
}

interface AccessPanelBodyProps {
  readonly draft: AccessDraft
  readonly query: string
  readonly setQuery: (query: string) => void
  readonly users: readonly User[]
  readonly busy: boolean
}

function AccessPanelBody({ draft, query, setQuery, users, busy }: AccessPanelBodyProps) {
  const ownerCandidates = useMemo(() => ownerOptions(users, draft.owner), [users, draft.owner])
  const filteredOwners = useMemo(
    () => rankBySearch(ownerCandidates, query, (option) => [option.label, option.value]),
    [ownerCandidates, query],
  )
  // The server excludes the owner from `grants` (their rights are implicit), so
  // a card for them could only ever be a no-op that looks saved — the Owner
  // section is where that choice lives.
  const grantable = useMemo(
    () =>
      rankBySearch(users, query, (user) => [user.display_name, user.username]).filter(
        (user) => user.username !== draft.owner,
      ),
    [users, query, draft.owner],
  )

  return (
    <>
      <div className="relative">
        <span
          className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-ink-dim"
          aria-hidden="true"
        >
          <IconSearch size={16} />
        </span>
        <Input
          type="search"
          autoComplete="off"
          className="pl-9"
          value={query}
          placeholder="Search users…"
          aria-label="Search users"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <CatalogSection heading="Owner">
        <p className="text-sm text-muted">The owner holds every capability. Choosing a card transfers ownership.</p>
        {filteredOwners.length === 0 ? (
          <p className="text-sm text-muted">No users match.</p>
        ) : (
          <CardGrid>
            {filteredOwners.map((option) => (
              <UserCard
                key={option.value}
                label={option.label}
                username={option.value}
                selected={draft.owner === option.value}
                busy={busy}
                onClick={() => draft.setOwner(option.value)}
              />
            ))}
          </CardGrid>
        )}
      </CatalogSection>

      {CAPABILITIES.map((capability) => (
        <CatalogSection key={capability} heading={capabilityLabel(capability)}>
          {capability === "VIEW" && draft.grants[capability].length === 0 ? (
            <p className="text-sm text-muted">Only the owner can see this item.</p>
          ) : null}
          {grantable.length === 0 ? (
            <p className="text-sm text-muted">No other users match.</p>
          ) : (
            <CardGrid>
              {grantable.map((user) => {
                const selected = draft.grants[capability].includes(user.username)
                return (
                  <UserCard
                    key={user.username}
                    label={userLabel(user)}
                    username={user.username}
                    selected={selected}
                    busy={busy}
                    onClick={() =>
                      selected ? draft.revoke(capability, user.username) : draft.grant(capability, user.username)
                    }
                  />
                )
              })}
            </CardGrid>
          )}
        </CatalogSection>
      ))}
    </>
  )
}

function CatalogSection({ heading, children }: { readonly heading: string; readonly children: ReactNode }) {
  const headingId = useId()
  return (
    <section className="flex flex-col gap-2" aria-labelledby={headingId}>
      <h3 id={headingId} className="text-base font-medium text-muted">
        {heading}
      </h3>
      {children}
    </section>
  )
}

function CardGrid({ children }: { readonly children: ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">{children}</div>
}

const CARD_CLASS =
  "flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2 py-2 text-left transition-colors " +
  "[&:hover:not(:disabled)]:border-line-strong [&:hover:not(:disabled)]:bg-surface-3 disabled:opacity-45"

const CARD_SELECTED_CLASS = "data-[granted=true]:border-brand data-[granted=true]:bg-[var(--accent-dim)]"

interface UserCardProps {
  readonly label: string
  readonly username: string
  readonly selected: boolean
  readonly busy: boolean
  readonly onClick: () => void
}

function UserCard({ label, username, selected, busy, onClick }: UserCardProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-granted={selected}
      disabled={busy}
      onClick={onClick}
      className={cn(CARD_CLASS, selected && CARD_SELECTED_CLASS)}
    >
      <Avatar name={label} small />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base">{label}</span>
        <span className="block truncate text-xs text-ink-dim [font-family:var(--font-mono)]">@{username}</span>
      </span>
      {selected ? (
        <span className="shrink-0 text-brand" aria-hidden="true">
          <IconCheck size={16} />
        </span>
      ) : null}
    </button>
  )
}
