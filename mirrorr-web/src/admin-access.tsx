import { useState, type MouseEvent } from "react"
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import { HoverCard } from "radix-ui"
import { fetchResourceAccess, fetchUsers, getErrorMessage } from "@/api"
import {
  applyPlans,
  overrideOf,
  planBulk,
  planItem,
  type AccessRow,
  type AccessTarget,
  type ItemPlan,
} from "@/api/domain/access-plan"
import { queryKeys, queryRoots, staleTimes } from "@/api/query-keys"
import type { ResourceType } from "@/api/schemas/privileged"
import type { User } from "@/api/schemas/user"
import {
  Button,
  Checkbox,
  Dialog,
  Drawer,
  ErrorPanel,
  IconButton,
  Select,
  SkeletonRows,
  Tag,
  toast,
} from "@/ui/components"
import { IconUser } from "@/ui/components/icons"
import { useMediaQuery } from "@/ui/hooks"
import {
  ResourceAccessFields,
  overrideLabel,
  resourceTypeLabel,
  userLabel,
  usernameLabel,
} from "@/ui/views/shared/resource-access"
import type {
  ResourceAccessBulkActionProps,
  ResourceAccessButtonProps,
  ResourceAccessSlot,
} from "@/ui/views/shared/resource-access-slot"

const HOVER_CARD_CLASS =
  "z-[var(--z-popover)] w-[360px] p-4 bg-surface-3 border border-line-strong rounded-md shadow-elev-md"

function useUsers(): readonly User[] {
  const query = useQuery({ queryKey: queryKeys.users, queryFn: fetchUsers, staleTime: staleTimes.users })
  return query.data ?? []
}

function invalidateAccess(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: queryRoots.adminResources })
}

function viewersText(viewers: readonly string[], users: readonly User[]): string {
  if (viewers.length === 0) return "Owner only"
  return viewers.map((viewer) => usernameLabel(users, viewer)).join(", ")
}

function AccessDelta({ plan, users }: { readonly plan: ItemPlan; readonly users: readonly User[] }) {
  const ownerChanged = plan.from.owner !== plan.to.owner
  const viewersChanged =
    plan.from.viewers.length !== plan.to.viewers.length ||
    plan.from.viewers.some((viewer) => !plan.to.viewers.includes(viewer))

  return (
    <ul className="flex flex-col gap-1 text-sm">
      <li className="flex items-center gap-2">
        <span className="text-muted">Owner</span>
        {ownerChanged ? (
          <>
            <span className="text-muted line-through">{usernameLabel(users, plan.from.owner)}</span>
            <span aria-hidden="true">→</span>
            <span>{usernameLabel(users, plan.to.owner)}</span>
          </>
        ) : (
          <span>{usernameLabel(users, plan.from.owner)}</span>
        )}
      </li>
      <li className="flex items-start gap-2">
        <span className="text-muted">View access</span>
        {viewersChanged ? (
          <>
            <span className="text-muted line-through">{viewersText(plan.from.viewers, users)}</span>
            <span aria-hidden="true">→</span>
            <span>{viewersText(plan.to.viewers, users)}</span>
          </>
        ) : (
          <span>{viewersText(plan.from.viewers, users)}</span>
        )}
      </li>
    </ul>
  )
}

interface ItemAccessEditorProps {
  readonly resourceType: ResourceType
  readonly id: number
  readonly label: string
  readonly access: { readonly owner: string; readonly viewers: readonly string[] }
  readonly users: readonly User[]
}

function ItemAccessEditor({ resourceType, id, label, access, users }: ItemAccessEditorProps) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const override = overrideOf(access, users.map((user) => user.username))

  // Not `useMutation`: the hover card unmounts on pointer-out, and a mutation
  // observer dies with its component, dropping the toast and the invalidation
  // while the writes themselves already landed.
  async function apply(target: AccessTarget): Promise<void> {
    setBusy(true)
    const outcome = await applyPlans([
      planItem(
        { resourceType, id, label, access },
        target,
        users.map((user) => user.username),
      ),
    ])
    setBusy(false)
    invalidateAccess(queryClient)
    if (outcome.failed.length > 0) toast.error("Could not update access", outcome.failed[0].message)
    else toast.success("Access updated", label)
  }

  return (
    <div className="flex flex-col gap-4">
      {override !== null ? (
        <Tag title="This item's access was set on the item itself, not inherited.">
          {overrideLabel(override)}
        </Tag>
      ) : null}
      <ResourceAccessFields
        access={access}
        users={users}
        busy={busy}
        onApply={(target) => void apply(target)}
      />
    </div>
  )
}

function AccessPanel({ resourceType, id, label }: ResourceAccessButtonProps) {
  const users = useUsers()
  const accessQuery = useQuery({
    queryKey: queryKeys.adminResourceAccess(resourceType, id),
    queryFn: () => fetchResourceAccess(resourceType, id),
    staleTime: staleTimes.adminResources,
  })

  if (accessQuery.isLoading) return <SkeletonRows rows={3} cols={2} />
  if (accessQuery.isError) {
    return (
      <ErrorPanel
        message={getErrorMessage(accessQuery.error, "Could not load access")}
        onRetry={() => void accessQuery.refetch()}
      />
    )
  }
  const access = accessQuery.data
  if (access === undefined) return <SkeletonRows rows={3} cols={2} />
  return (
    <ItemAccessEditor
      resourceType={resourceType}
      id={id}
      label={label}
      access={access}
      users={users}
    />
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
  const [drawerOpen, setDrawerOpen] = useState(false)
  const hoverCapable = useMediaQuery("(hover: hover) and (pointer: fine)")

  if (!hoverCapable) {
    return (
      <span className="contents" onClick={swallowClick}>
        <IconButton
          label={`Access for ${label}`}
          icon={<IconUser size={16} />}
          size="sm"
          onClick={() => setDrawerOpen(true)}
        />
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          side="right"
          title={`Access · ${label}`}
        >
          <AccessPanel resourceType={resourceType} id={id} label={label} />
        </Drawer>
      </span>
    )
  }

  return (
    <span className="contents" onClick={swallowClick}>
      <HoverCard.Root openDelay={150} closeDelay={150}>
        <HoverCard.Trigger asChild>
          <IconButton label={`Access for ${label}`} icon={<IconUser size={16} />} size="sm" />
        </HoverCard.Trigger>
        <HoverCard.Portal>
          <HoverCard.Content side="bottom" align="end" sideOffset={8} className={HOVER_CARD_CLASS}>
            <AccessPanel resourceType={resourceType} id={id} label={label} />
          </HoverCard.Content>
        </HoverCard.Portal>
      </HoverCard.Root>
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
  const accessQueries = useQueries({
    queries: items.map((item) => ({
      queryKey: queryKeys.adminResourceAccess(resourceType, item.id),
      queryFn: () => fetchResourceAccess(resourceType, item.id),
      staleTime: staleTimes.adminResources,
    })),
  })

  const [changeOwner, setChangeOwner] = useState(false)
  const [owner, setOwner] = useState("")
  const [changeViewers, setChangeViewers] = useState(false)
  const [viewers, setViewers] = useState<readonly string[]>([])
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
        access: { owner: data.owner, viewers: data.viewers },
      },
    ]
  })

  const target: AccessTarget = {
    ...(changeOwner ? { owner } : {}),
    ...(changeViewers ? { viewers } : {}),
  }
  const plan = planBulk(rows, target, usernames)
  /** Items carrying their own access — read out whether or not the target touches them. */
  const overridden = plan.items.filter((item) => item.override !== null).length
  const ready = plan.opCount > 0 && (!changeOwner || owner !== "")

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
      size="lg"
      title={confirming ? `Override ${plan.overriding.length} item(s)?` : `Access on ${items.length} item(s)`}
      description={
        confirming
          ? "These items carry their own access. Applying replaces it."
          : "Nothing is sent until you apply."
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
              <AccessDelta plan={item} users={users} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Checkbox
              label="Change owner"
              checked={changeOwner}
              disabled={busy}
              onChange={(event) => setChangeOwner(event.target.checked)}
            />
            <Select
              aria-label="New owner"
              value={owner}
              disabled={busy || !changeOwner}
              onChange={(event) => setOwner(event.target.value)}
            >
              <option value="">Select a user…</option>
              {users.map((user) => (
                <option key={user.username} value={user.username}>
                  {userLabel(user)}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Checkbox
              label="Replace view grants"
              checked={changeViewers}
              disabled={busy}
              onChange={(event) => setChangeViewers(event.target.checked)}
            />
            <div className="flex flex-col gap-1 max-h-[160px] overflow-y-auto">
              {users.map((user) => (
                <Checkbox
                  key={user.username}
                  label={userLabel(user)}
                  checked={viewers.includes(user.username)}
                  disabled={busy || !changeViewers}
                  onChange={(event) =>
                    setViewers((current) =>
                      event.target.checked
                        ? [...current, user.username]
                        : current.filter((viewer) => viewer !== user.username),
                    )
                  }
                />
              ))}
            </div>
          </div>

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
                <AccessDelta plan={item} users={users} />
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
