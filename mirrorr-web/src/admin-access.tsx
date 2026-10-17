import { useRef, useState, type MouseEvent } from "react"
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import { fetchGroups, fetchResourceAccess, fetchUsers, getErrorMessage } from "@/api"
import {
  applyPlans,
  bulkTargetFor,
  emptyGrants,
  emptyGroupGrants,
  itemAccessFromView,
  planBulk,
  type AccessRow,
  type ItemAccess,
  type ItemPlan,
} from "@/api/domain/access-plan"
import { queryKeys, queryRoots, staleTimes } from "@/api/query-keys"
import { CAPABILITIES, type Capability, type Group, type ResourceType } from "@/api/schemas/privileged"
import type { User } from "@/api/schemas/user"
import {
  Banner,
  Button,
  Dialog,
  ErrorPanel,
  IconButton,
  SkeletonRows,
  Tag,
  toast,
} from "@/ui/components"
import { IconUser } from "@/ui/components/icons"
import { AccessPanel } from "@/ui/views/shared/access-panel"
import {
  ResourceAccessEditor,
  capabilityLabel,
  overrideLabel,
  resourceTypeLabel,
  useAccessDraft,
  usernameLabel,
} from "@/ui/views/shared/resource-access"
import type {
  ResourceAccessBulkActionProps,
  ResourceAccessButtonProps,
  ResourceAccessSlot,
} from "@/ui/views/shared/resource-access-slot"

function useUsers(): readonly User[] {
  const query = useQuery({ queryKey: queryKeys.users, queryFn: fetchUsers, staleTime: staleTimes.users })
  return query.data ?? []
}

function useGroups(): readonly Group[] {
  const query = useQuery({ queryKey: queryKeys.groups, queryFn: fetchGroups, staleTime: staleTimes.users })
  return query.data?.items ?? []
}

function invalidateAccess(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: queryRoots.adminResources })
}

/** A bulk draft starts empty: it names what to set, never what each item has. */
const EMPTY_DRAFT: ItemAccess = {
  owner: null,
  ownerMissing: false,
  grants: emptyGrants(),
  groupGrants: emptyGroupGrants(),
  ownerUsers: [],
  ownerGroups: [],
}

function groupLabel(groups: readonly Group[], id: number): string {
  const group = groups.find((candidate) => candidate.id === id)
  if (group === undefined) return `#${id}`
  return group.display_name !== "" ? group.display_name : group.name
}

function groupsText(ids: readonly number[], groups: readonly Group[]): string {
  if (ids.length === 0) return "None"
  return ids.map((id) => groupLabel(groups, id)).join(", ")
}

function usersText(usernames: readonly string[], users: readonly User[]): string {
  if (usernames.length === 0) return "None"
  return usernames.map((username) => usernameLabel(users, username)).join(", ")
}

/** Everyone holding this capability, users and groups in one list. */
function holdersText(
  access: ItemAccess,
  capability: Capability,
  users: readonly User[],
  groups: readonly Group[],
): string {
  const labels = [
    ...access.grants[capability].map((username) => usernameLabel(users, username)),
    ...(access.groupGrants?.[capability] ?? []).map((id) => groupLabel(groups, id)),
  ]
  return labels.length === 0 ? "None" : labels.join(", ")
}

function sameSet<T>(from: readonly T[], to: readonly T[]): boolean {
  return from.length === to.length && from.every((value) => to.includes(value))
}

function DeltaRow({ label, from, to }: { readonly label: string; readonly from: string; readonly to: string }) {
  return (
    <li className="flex items-start gap-2">
      <span className="text-muted">{label}</span>
      <span className="text-muted line-through">{from}</span>
      <span aria-hidden="true">→</span>
      <span>{to}</span>
    </li>
  )
}

/** Only what the change actually moves: a capability's holders, users and groups. */
function AccessDelta({
  plan,
  users,
  groups,
}: {
  readonly plan: ItemPlan
  readonly users: readonly User[]
  readonly groups: readonly Group[]
}) {
  const capabilities = CAPABILITIES.filter(
    (capability) =>
      !sameSet(plan.from.grants[capability], plan.to.grants[capability]) ||
      !sameSet(plan.from.groupGrants?.[capability] ?? [], plan.to.groupGrants?.[capability] ?? []),
  )
  const fromOwnerUsers = plan.from.ownerUsers ?? []
  const toOwnerUsers = plan.to.ownerUsers ?? []
  const fromOwnerGroups = plan.from.ownerGroups ?? []
  const toOwnerGroups = plan.to.ownerGroups ?? []
  const ownerChanged = plan.from.owner !== plan.to.owner
  const ownerUsersChanged = !sameSet(fromOwnerUsers, toOwnerUsers)
  const ownerGroupsChanged = !sameSet(fromOwnerGroups, toOwnerGroups)

  if (!ownerChanged && !ownerUsersChanged && !ownerGroupsChanged && capabilities.length === 0) {
    return <p className="text-sm text-muted">No change</p>
  }

  return (
    <ul className="flex flex-col gap-1 text-sm">
      {ownerChanged ? (
        <DeltaRow
          label="Owner"
          from={usernameLabel(users, plan.from.owner ?? "")}
          to={usernameLabel(users, plan.to.owner ?? "")}
        />
      ) : null}
      {capabilities.map((capability) => (
        <DeltaRow
          key={capability}
          label={capabilityLabel(capability)}
          from={holdersText(plan.from, capability, users, groups)}
          to={holdersText(plan.to, capability, users, groups)}
        />
      ))}
      {ownerUsersChanged ? (
        <DeltaRow
          label="Owner users"
          from={usersText(fromOwnerUsers, users)}
          to={usersText(toOwnerUsers, users)}
        />
      ) : null}
      {ownerGroupsChanged ? (
        <DeltaRow
          label="Owner groups"
          from={groupsText(fromOwnerGroups, groups)}
          to={groupsText(toOwnerGroups, groups)}
        />
      ) : null}
    </ul>
  )
}

/**
 * Portals bubble through the React tree, not the DOM tree, so without this a click on the
 * panel's own padding, labels or backdrop reaches the card's click handler and navigates.
 */
function swallowClick(event: MouseEvent<HTMLElement>): void {
  event.stopPropagation()
}

export function ResourceAccessButton({ resourceType, id, label }: ResourceAccessButtonProps) {
  const [open, setOpen] = useState(false)
  const restoreRef = useRef<HTMLElement | null>(null)

  return (
    <span className="contents" onClick={swallowClick}>
      <IconButton
        label={`Access for ${label}`}
        icon={<IconUser size={16} />}
        size="sm"
        onClick={(event) => {
          restoreRef.current = event.currentTarget
          setOpen(true)
        }}
      />
      {open ? (
        <AccessPanel
          resourceType={resourceType}
          id={id}
          label={label}
          onClose={() => {
            setOpen(false)
            restoreRef.current?.focus()
          }}
        />
      ) : null}
    </span>
  )
}

interface BulkAccessDialogProps {
  readonly resourceType: ResourceType
  readonly items: ResourceAccessBulkActionProps["items"]
  readonly onClose: () => void
}

function BulkAccessDialog({ resourceType, items, onClose }: BulkAccessDialogProps) {
  const queryClient = useQueryClient()
  const users = useUsers()
  const groups = useGroups()
  const draft = useAccessDraft(EMPTY_DRAFT)
  const accessQueries = useQueries({
    queries: items.map((item) => ({
      queryKey: queryKeys.adminResourceAccess(resourceType, item.id),
      queryFn: () => fetchResourceAccess(resourceType, item.id),
      staleTime: staleTimes.adminResources,
    })),
  })

  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failures, setFailures] = useState<readonly { label: string; message: string }[]>([])

  const usernames = users.map((user) => user.username)
  const loading = accessQueries.some((query) => query.isLoading)
  const failed = accessQueries.find((query) => query.isError)
  const rows: AccessRow[] = items.flatMap((item, index) => {
    const data = accessQueries[index]?.data
    if (data === undefined) return []
    return [
      {
        resourceType,
        id: item.id,
        label: item.label,
        access: itemAccessFromView(data),
      },
    ]
  })

  const plan = planBulk(rows, (row) => bulkTargetFor(row, draft.target), usernames)
  /** Items carrying their own access — read out whether or not the target touches them. */
  const overridden = plan.items.filter((item) => item.override !== null).length
  const ready = plan.opCount > 0
  const everyoneGranted = groups.some(
    (group) =>
      group.system &&
      CAPABILITIES.some((capability) => draft.groupGrants[capability].includes(group.id)),
  )

  async function apply(): Promise<void> {
    setBusy(true)
    const outcome = await applyPlans(plan.items)
    setBusy(false)
    invalidateAccess(queryClient)
    setFailures(
      outcome.failed.map((failure) => ({ label: failure.plan.label, message: failure.message })),
    )
    if (outcome.failed.length === 0) {
      toast.success("Access updated", `${outcome.applied.length} item(s) changed.`)
      onClose()
      return
    }
    toast.error(
      "Some items could not be changed",
      `${outcome.applied.length} applied, ${outcome.failed.length} failed.`,
    )
  }

  return (
    <Dialog
      open
      onClose={onClose}
      busy={busy}
      size="xl"
      title={confirming ? `Override ${plan.overriding.length} item(s)?` : `Access on ${items.length} item(s)`}
      description={
        confirming
          ? "These items carry their own access. Applying changes the parts you filled in."
          : "Nothing is sent until you apply. What you leave empty stays as it is."
      }
      footer={
        confirming ? (
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
              Back to editing
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void apply()}>
              Override and apply
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!ready || loading || failed !== undefined}
              onClick={() => {
                if (plan.overriding.length > 0) setConfirming(true)
                else void apply()
              }}
            >
              Apply to {items.length}
            </Button>
          </>
        )
      }
    >
      {loading ? (
        <SkeletonRows rows={4} cols={2} />
      ) : failed !== undefined ? (
        <ErrorPanel
          message={getErrorMessage(failed.error, "Could not load access")}
          onRetry={() => void Promise.all(accessQueries.map((query) => query.refetch()))}
        />
      ) : confirming ? (
        <ul className="flex flex-col gap-3">
          {plan.overriding.map((item) => (
            <li key={item.id} className="flex flex-col gap-2 border border-line rounded-md p-3">
              <span className="font-medium">
                {item.label} <span className="text-muted">{resourceTypeLabel(resourceType)}</span>
              </span>
              <AccessDelta plan={item} users={users} groups={groups} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col gap-4">
          <ResourceAccessEditor
            resourceType={resourceType}
            draft={draft}
            users={users}
            groups={groups}
            busy={busy}
            emptyOwnerLabel="Left as it is"
          />

          {everyoneGranted ? (
            <Banner kind="warning" title="“everyone” is selected">
              Every account, including future ones, gets the access chosen here on these items.
            </Banner>
          ) : null}

          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted">{plan.opCount} change(s) planned</span>
            {overridden > 0 ? <Tag>{`${overridden} already overridden`}</Tag> : null}
          </div>

          {failures.length > 0 ? (
            <div className="flex flex-col gap-1 text-sm text-danger" role="alert">
              {failures.map((failure) => (
                <span key={failure.label}>
                  {failure.label}: {failure.message}
                </span>
              ))}
            </div>
          ) : null}

          <ul className="flex flex-col gap-3 max-h-[42vh] overflow-y-auto">
            {plan.items.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-2 border border-line rounded-md p-3"
                data-overridden={item.override !== null}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-truncate">{item.label}</span>
                  {item.override !== null ? <Tag>{overrideLabel(item.override)}</Tag> : null}
                </div>
                <AccessDelta plan={item} users={users} groups={groups} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  )
}

export function BulkAccessAction({ resourceType, items }: ResourceAccessBulkActionProps) {
  const [open, setOpen] = useState(false)

  return (
    <span className="contents" onClick={swallowClick}>
      <Button
        size="sm"
        variant="secondary"
        icon={<IconUser size={15} />}
        disabled={items.length === 0}
        onClick={() => setOpen(true)}
      >
        Access
      </Button>
      {open ? (
        <BulkAccessDialog resourceType={resourceType} items={items} onClose={() => setOpen(false)} />
      ) : null}
    </span>
  )
}

export const ADMIN_ACCESS_SLOT: ResourceAccessSlot = {
  Button: ResourceAccessButton,
  BulkAction: BulkAccessAction,
}
