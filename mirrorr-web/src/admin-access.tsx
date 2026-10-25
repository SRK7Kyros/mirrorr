import { useEffect, useRef, useState, type MouseEvent } from "react"
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import { fetchGroups, fetchResourceAccess, fetchUsers, getErrorMessage, useAuthState } from "@/api"
import {
  applyPlans,
  bulkTargetFor,
  crownKey,
  emptyGrants,
  emptyGroupGrants,
  grantedGroupIds,
  grantedUsernames,
  itemAccessFromView,
  planBulk,
  planItem,
  type AccessRow,
  type AccessTarget,
  type BulkMode,
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
import { IconChevronRight, IconUser } from "@/ui/components/icons"
import { AccessPanel } from "@/ui/views/shared/access-panel"
import {
  ResourceAccessEditor,
  capabilityLabel,
  crownLabel,
  overrideLabel,
  resourceTypeLabel,
  useAccessDraft,
  usernameLabel,
} from "@/ui/views/shared/resource-access"
import type {
  ResourceAccessBulkDialogProps,
  ResourceAccessButtonProps,
  ResourceAccessCreationProps,
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
  crown: null,
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
  const ownerChanged = crownKey(plan.from.crown) !== crownKey(plan.to.crown)
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
          from={crownLabel(plan.from.crown, users, groups, "None")}
          to={crownLabel(plan.to.crown, users, groups, "None")}
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
        icon={<IconUser size={15} />}
        // `md` matches the row's own actions; a shorter box rides the top of a stretch row.
        size="md"
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

export function BulkAccessDialog({ resourceType, items, onClose }: ResourceAccessBulkDialogProps) {
  return (
    <span className="contents" onClick={swallowClick}>
      <BulkAccessDialogBody resourceType={resourceType} items={items} onClose={onClose} />
    </span>
  )
}

function BulkAccessDialogBody({ resourceType, items, onClose }: ResourceAccessBulkDialogProps) {
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
  const [mode, setMode] = useState<BulkMode>("grant")
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

  const plan = planBulk(rows, (row) => bulkTargetFor(row, draft.target, mode), usernames)
  const overridingItems =
    mode === "replace"
      ? plan.overriding
      : plan.overriding.filter((item) => item.ops.some((op) => op.kind === "crown"))
  /** Items carrying their own access — read out whether or not the target touches them. */
  const overridden = plan.items.filter((item) => item.override !== null).length
  const ready = plan.opCount > 0
  const everyoneGranted =
    mode !== "revoke" &&
    groups.some(
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

  const editHint =
    mode === "replace"
      ? "Nothing is sent until you apply. Replace resets each item to its owners first, so anyone you leave out loses access."
      : "Nothing is sent until you apply. What you leave empty stays as it is.";
  const confirmHint =
    mode === "replace"
      ? "These items carry their own access. Replace clears it first: a principal you did not name here loses access."
      : "These items carry their own access. Applying changes the parts you filled in.";

  return (
    <Dialog
      open
      onClose={onClose}
      busy={busy}
      size="xl"
      title={confirming ? `Override ${overridingItems.length} item(s)?` : `Access on ${items.length} item(s)`}
      description={confirming ? confirmHint : editHint}
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
                if (overridingItems.length > 0) setConfirming(true)
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
          {overridingItems.map((item) => (
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
            mode={mode}
            onModeChange={setMode}
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

/**
 * The creation panels' access section. It owns its draft and reports the target
 * upward on mount and after every edit, so the form can apply it once the core
 * has answered with an id — a create cannot carry grants in its own body. The
 * creator becomes the owner, which is what the crown slot starts on; an owner
 * added here is a co-owner, and crowning one hands the item over.
 */
export function CreationAccess({ resourceType, onChange, busy = false }: ResourceAccessCreationProps) {
  const users = useUsers()
  const groups = useGroups()
  const me = useAuthState().auth?.user ?? null
  const draft = useAccessDraft(EMPTY_DRAFT)
  const [open, setOpen] = useState(false)

  const signature = JSON.stringify(draft.target)
  const reported = useRef<string | null>(null)
  useEffect(() => {
    if (reported.current === signature) return
    reported.current = signature
    onChange(draft.target)
  }, [signature, draft.target, onChange])

  const creator =
    me === null ? "You" : me.display_name !== "" ? me.display_name : me.username
  const principals = grantedUsernames(draft).length + grantedGroupIds(draft).length
  const owners = draft.ownerUsers.length + draft.ownerGroups.length
  const everyoneGranted = groups.some(
    (group) =>
      group.system &&
      CAPABILITIES.some((capability) => draft.groupGrants[capability].includes(group.id)),
  )
  const summary =
    owners === 0 && principals === 0
      ? "Owners only"
      : [
          owners === 0 ? "" : `${owners} owner${owners === 1 ? "" : "s"}`,
          principals === 0 ? "" : `${principals} principal${principals === 1 ? "" : "s"}`,
        ]
          .filter((part) => part !== "")
          .join(" · ")

  return (
    <section className="flex flex-col gap-2" data-testid="access-creation">
      <button
        type="button"
        aria-expanded={open}
        data-testid="access-creation-toggle"
        onClick={() => setOpen((current) => !current)}
        className="tab-stop flex w-full items-center gap-2 rounded-md border border-line-subtle bg-surface-1 px-3 py-2 text-left transition-colors [&:hover]:border-line-strong"
      >
        <IconUser size={16} className="shrink-0 text-ink-dim" />
        <span className="text-sm font-semibold tracking-wider text-ink uppercase">Access</span>
        <span className="text-sm text-ink-dim">{summary}</span>
        <IconChevronRight
          size={16}
          aria-hidden="true"
          className={`ms-auto shrink-0 text-ink-dim transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>

      {open ? (
        <div className="flex flex-col gap-3 rounded-md border border-line-subtle bg-surface-1 p-3">
          <ResourceAccessEditor
            resourceType={resourceType}
            draft={draft}
            users={users}
            groups={groups}
            busy={busy}
            creation
            emptyOwnerLabel={creator}
          />

          {everyoneGranted ? (
            <Banner kind="warning" title="“everyone” is selected">
              Every account, including future ones, gets the capabilities chosen here on this item.
            </Banner>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

/** The created row carries nothing yet, so the plan is exactly the draft. */
export async function applyCreationAccess(
  resourceType: ResourceType,
  id: number,
  target: AccessTarget,
): Promise<void> {
  const plan = planItem({ resourceType, id, label: String(id), access: EMPTY_DRAFT }, target, [])
  const outcome = await applyPlans([plan])
  const failure = outcome.failed[0]
  if (failure !== undefined) throw new Error(failure.message)
}

export const ADMIN_ACCESS_SLOT: ResourceAccessSlot = {
  Button: ResourceAccessButton,
  BulkDialog: BulkAccessDialog,
  Creation: CreationAccess,
  applyCreation: applyCreationAccess,
}
