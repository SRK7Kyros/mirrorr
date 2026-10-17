import { useMemo, useRef, useState, type KeyboardEvent } from "react"
import {
  type AccessOverride,
  type AccessTarget,
  type ItemAccess,
  emptyGroupGrants,
} from "@/api/domain/access-plan"
import { rankBySearch } from "@/api/domain/search"
import { CAPABILITIES, type Capability } from "@/api/schemas/privileged"
import type { User } from "@/api/schemas/user"
import { Avatar, Badge, Button, IconButton, Input } from "@/ui/components"
import { IconCheck, IconCrown, IconSearch, IconUser, IconX } from "@/ui/components/icons"
import { useSelection } from "@/ui/hooks"
import { cn } from "@/ui/lib/cn"
import { useMarqueeSelection } from "./marquee"

export const RESOURCE_TYPE_LABEL: Record<string, string> = {
  session: "Session",
  profile: "Profile",
  autorun: "Autorun",
  recording: "Recording",
  source: "Source",
  engine: "Engine",
  resolver: "Resolver",
}

export function resourceTypeLabel(type: string): string {
  return RESOURCE_TYPE_LABEL[type] ?? type
}

export function userLabel(user: User): string {
  return user.display_name !== "" ? user.display_name : user.username
}

export function usernameLabel(users: readonly User[], username: string): string {
  const user = users.find((candidate) => candidate.username === username)
  return user === undefined ? `${username} (missing)` : userLabel(user)
}

/**
 * `override.count` is the number of distinct users holding *any* capability, so
 * the copy names users, not view grants — the old "N view grants" described a
 * flat viewer list that no longer exists.
 */
export function overrideLabel(override: AccessOverride): string {
  if (override.kind === "owner-missing") return "Owner account missing"
  return override.count === 1 ? "1 user or group with access" : `${override.count} users or groups with access`
}

/**
 * Capability labels, in the frozen `CAPABILITIES` order. Only `VIEW` keeps its
 * established copy ("View access") — the e2e and unit specs pin that exact
 * string, so renaming it is a contract change, not a wording preference.
 */
export const CAPABILITY_LABEL: Record<Capability, string> = {
  VIEW: "View access",
  OPERATE: "Operate",
  EDIT: "Edit",
  DELETE: "Delete",
  SHARE: "Share",
  EXPORT: "Export",
}

/** The established label for one capability ("View access", "Operate", …). */
export function capabilityLabel(capability: Capability): string {
  return CAPABILITY_LABEL[capability]
}

/**
 * The capabilities each owner-bearing type actually enforces — the editor
 * offers only controls the core honours (routes in
 * `mirrorr-core/src/mirrorr/api/routers/`). A capability with no route for a
 * type is inert, so it is not offered. Engines and resolvers are ownerless
 * system rows that never open this editor, so an unknown type keeps all six.
 */
export const TYPE_CAPABILITIES: Record<string, readonly Capability[]> = {
  session: ["VIEW", "OPERATE", "EDIT", "DELETE", "SHARE"], // view/list/detail+logs · stop/recording · save-as-profile · delete · shares
  autorun: ["VIEW", "EDIT", "DELETE", "SHARE", "EXPORT"], // view · update+save-as-profile · delete · shares · /import-export/autoruns/{id}/export
  recording: ["VIEW", "DELETE", "SHARE"], // view · delete · shares
  profile: ["VIEW", "EDIT", "DELETE", "SHARE", "EXPORT"], // view · update+profile-link · delete · shares · /import-export/profiles/{id}/export
  source: ["VIEW", "EDIT", "DELETE", "SHARE"], // view · update · delete · shares
}

/** The capabilities the editor offers for a type (all six when it is unknown). */
export function offeredCapabilities(resourceType: string): readonly Capability[] {
  return TYPE_CAPABILITIES[resourceType] ?? CAPABILITIES
}

/**
 * VIEW is the base capability: a user who holds anything at all holds VIEW,
 * because the core implies it. Every read of a capability set goes through this
 * so a stray OPERATE-only row still reads as visible.
 */
export function holdsCapability(
  grants: Readonly<Record<Capability, readonly string[]>>,
  capability: Capability,
  username: string,
): boolean {
  if (capability === "VIEW") {
    return CAPABILITIES.some((candidate) => grants[candidate].includes(username))
  }
  return grants[capability].includes(username)
}

/* ── groups (plan: granular-permissions-and-access-panel, wave 6) ───────
 *
 * A group is a principal just like a user: it can be the target of capability
 * grants and, additionally, an owner (ownership is ADDITIVE — the single user
 * owner is untouched). The editor renders one mental model over whichever
 * catalog is active, so group grants reuse the exact chip machinery user grants
 * do. The reserved `everyone` group is always offered and covers every account,
 * existing and future.
 */

/** A group as the editor renders it — a `GET /groups` item, member list aside. */
export interface AccessGroup {
  readonly id: number
  readonly name: string
  readonly display_name: string
  readonly system: boolean
  readonly member_count?: number
}

/** The group's human label — its `display_name`, falling back to its name. */
export function groupLabel(group: AccessGroup): string {
  return group.display_name !== "" ? group.display_name : group.name
}

/** The reserved `everyone` group — the only one that covers future accounts. */
export function isEveryoneGroup(group: AccessGroup): boolean {
  return group.system === true || group.name === "everyone"
}

/** What the `everyone` group's membership line reads, in place of a count. */
export const EVERYONE_NOTE = "every account, including future ones"

/** The loud inline warning shown while `everyone` owns an item. */
export const EVERYONE_OWNER_WARNING =
  "Every account gets full control of this item, including delete."

/** The member line on a group card — a count, or the implicit-membership note. */
export function groupMembersLabel(group: AccessGroup): string {
  if (isEveryoneGroup(group)) return EVERYONE_NOTE
  const count = group.member_count ?? 0
  return count === 1 ? "1 member" : `${count} members`
}

/** VIEW is the base capability for a group too: any held capability implies it. */
export function holdsGroupCapability(
  groupGrants: Readonly<Record<Capability, readonly number[]>>,
  capability: Capability,
  groupId: number,
): boolean {
  if (capability === "VIEW") {
    return CAPABILITIES.some((candidate) => (groupGrants[candidate] ?? []).includes(groupId))
  }
  return (groupGrants[capability] ?? []).includes(groupId)
}

function grantCapability(access: ItemAccess, capability: Capability, username: string): ItemAccess {
  const alreadyHeld = access.grants[capability].includes(username)
  const needsView = capability !== "VIEW" && !access.grants.VIEW.includes(username)
  if (alreadyHeld && !needsView) return access
  const grants = { ...access.grants }
  if (!alreadyHeld) grants[capability] = [...grants[capability], username]
  if (needsView) grants.VIEW = [...grants.VIEW, username]
  return { ...access, grants }
}

function revokeCapability(access: ItemAccess, capability: Capability, username: string): ItemAccess {
  if (capability === "VIEW") {
    // Clearing the base capability clears what it implies.
    const grants = { ...access.grants }
    let changed = false
    for (const candidate of CAPABILITIES) {
      if (!grants[candidate].includes(username)) continue
      grants[candidate] = grants[candidate].filter((name) => name !== username)
      changed = true
    }
    return changed ? { ...access, grants } : access
  }
  if (!access.grants[capability].includes(username)) return access
  return {
    ...access,
    grants: {
      ...access.grants,
      [capability]: access.grants[capability].filter((name) => name !== username),
    },
  }
}

function groupGrantRecord(access: ItemAccess): Record<Capability, number[]> {
  const groupGrants = emptyGroupGrants()
  for (const capability of CAPABILITIES) groupGrants[capability] = [...(access.groupGrants?.[capability] ?? [])]
  return groupGrants
}

function grantGroupCapability(access: ItemAccess, capability: Capability, groupId: number): ItemAccess {
  const groupGrants = groupGrantRecord(access)
  const alreadyHeld = groupGrants[capability].includes(groupId)
  const needsView = capability !== "VIEW" && !groupGrants.VIEW.includes(groupId)
  if (alreadyHeld && !needsView) return access
  if (!alreadyHeld) groupGrants[capability] = [...groupGrants[capability], groupId]
  if (needsView) groupGrants.VIEW = [...groupGrants.VIEW, groupId]
  return { ...access, groupGrants }
}

function revokeGroupCapability(access: ItemAccess, capability: Capability, groupId: number): ItemAccess {
  const groupGrants = groupGrantRecord(access)
  if (capability === "VIEW") {
    // Clearing the base capability clears what it implies.
    let changed = false
    for (const candidate of CAPABILITIES) {
      if (!groupGrants[candidate].includes(groupId)) continue
      groupGrants[candidate] = groupGrants[candidate].filter((id) => id !== groupId)
      changed = true
    }
    return changed ? { ...access, groupGrants } : access
  }
  if (!groupGrants[capability].includes(groupId)) return access
  groupGrants[capability] = groupGrants[capability].filter((id) => id !== groupId)
  return { ...access, groupGrants }
}

function accessSignature(access: ItemAccess): string {
  const grants = CAPABILITIES.map(
    (capability) => `${capability}:${[...access.grants[capability]].sort().join(",")}`,
  ).join("\u0001")
  const groupGrants = CAPABILITIES.map(
    (capability) => `${capability}:${[...(access.groupGrants?.[capability] ?? [])].sort((a, b) => a - b).join(",")}`,
  ).join("\u0002")
  const ownerGroups = [...(access.ownerGroups ?? [])].sort((a, b) => a - b).join(",")
  return [access.owner ?? "", access.ownerMissing, grants, groupGrants, ownerGroups].join("\u0000")
}

/** The group half of an edit — carried beside the user half on the same target. */
export type GroupDraftTarget = Pick<AccessTarget, "groupGrants" | "ownerGroups">

export interface AccessDraft {
  readonly owner: string
  readonly ownerMissing: boolean
  readonly grants: Readonly<Record<Capability, readonly string[]>>
  readonly groupGrants: Readonly<Record<Capability, readonly number[]>>
  readonly ownerGroups: readonly number[]
  readonly dirty: boolean
  readonly target: AccessTarget & GroupDraftTarget
  readonly setOwner: (username: string) => void
  readonly grant: (capability: Capability, username: string) => void
  readonly revoke: (capability: Capability, username: string) => void
  readonly grantGroup: (capability: Capability, groupId: number) => void
  readonly revokeGroup: (capability: Capability, groupId: number) => void
  readonly addOwnerGroup: (groupId: number) => void
  readonly removeOwnerGroup: (groupId: number) => void
}

/**
 * Capability-aware draft. The whole editor reads one `grants` record (and, for
 * groups, one `groupGrants` record) and edits it through the mutators; `target`
 * carries both records so the planner diffs them against the loaded access. The
 * `accessSignature` guard reloads the draft whenever the `access` prop really
 * changes — the signature covers the owner, ownerMissing, all six capability
 * lists, every group's capability list and the owner-group ids, so an equal prop
 * leaves in-flight edits intact.
 */
export function useAccessDraft(access: ItemAccess): AccessDraft {
  const [draft, setDraft] = useState<ItemAccess>(access)
  const loaded = useRef(accessSignature(access))
  const signature = accessSignature(access)
  if (loaded.current !== signature) {
    loaded.current = signature
    setDraft(access)
  }

  // The data layer always populates both group records; the guards keep the
  // editor whole against an item read that predates them, never a new shape.
  const groupGrants = draft.groupGrants ?? emptyGroupGrants()
  const ownerGroups = draft.ownerGroups ?? []

  return {
    owner: draft.owner ?? "",
    ownerMissing: draft.ownerMissing,
    grants: draft.grants,
    groupGrants,
    ownerGroups,
    dirty: accessSignature(draft) !== signature,
    target: {
      owner: draft.owner ?? undefined,
      grants: draft.grants,
      groupGrants,
      ownerGroups,
    },
    setOwner: (username) => setDraft((current) => ({ ...current, owner: username })),
    grant: (capability, username) => setDraft((current) => grantCapability(current, capability, username)),
    revoke: (capability, username) => setDraft((current) => revokeCapability(current, capability, username)),
    grantGroup: (capability, groupId) =>
      setDraft((current) => grantGroupCapability(current, capability, groupId)),
    revokeGroup: (capability, groupId) =>
      setDraft((current) => revokeGroupCapability(current, capability, groupId)),
    addOwnerGroup: (groupId) =>
      setDraft((current) => {
        const groups = current.ownerGroups ?? []
        return groups.includes(groupId) ? current : { ...current, ownerGroups: [...groups, groupId] }
      }),
    removeOwnerGroup: (groupId) =>
      setDraft((current) => ({
        ...current,
        ownerGroups: (current.ownerGroups ?? []).filter((id) => id !== groupId),
      })),
  }
}

/* ── the one editor ────────────────────────────────────────────────────
 *
 * Both surfaces (the per-item `AccessPanel` and the settings
 * `ResourceAccessDialog` through `ResourceAccessFields`) render this, so they
 * cannot drift. One principal switch (Users | Groups), one owner row with an
 * additive owner-group set, one catalog of cards, one search box, one upper
 * chip row that filters the catalog to a capability's holders, and one lower
 * chip row that applies a capability set to the selected cards. The user owner
 * and the owner groups are independent: adding a group never touches the user.
 */

const CARD_CLASS =
  "flex flex-col items-center gap-2 rounded-md border border-line bg-surface-2 p-2 text-center transition-colors " +
  "[&:hover:not(:disabled)]:border-line-strong [&:hover:not(:disabled)]:bg-surface-3 disabled:opacity-45"

const CARD_SELECTED_CLASS = "data-[granted=true]:border-brand data-[granted=true]:bg-[var(--accent-dim)]"

const OWNER_LIST_ID = "owner-group-options"

const CHIP_BASE =
  "inline-flex shrink-0 items-center gap-1.5 h-7 rounded-full border px-3 text-sm font-medium whitespace-nowrap " +
  "transition-colors [&:hover:not(:disabled)]:border-line-strong disabled:opacity-45"

const CHIP_ON = "border-brand bg-[var(--accent-dim)] text-ink"
const CHIP_OFF = "border-line bg-surface-2 text-ink-muted"
const CHIP_PARTIAL = "border-brand border-dashed bg-transparent text-ink"
type FilterMode = "include" | "exclude"
type Principal = "users" | "groups"

// A capability chip cycles off → include (green) → exclude (red) → off: green
// keeps the holders, red keeps the ones who do not hold, and they AND together.
const CHIP_EXCLUDE = "border-danger bg-danger-dim text-danger"

interface OwnerOption {
  readonly kind: "user" | "group"
  readonly id: string
  readonly label: string
  readonly detail: string
}

export interface ResourceAccessEditorProps {
  readonly resourceType: string
  readonly draft: AccessDraft
  readonly users: readonly User[]
  /** Required: a host that forgets the group list renders an empty Groups tab. */
  readonly groups: readonly AccessGroup[]
  readonly busy?: boolean
  /** The owner row's label when no owner is picked — a bulk host says so instead. */
  readonly emptyOwnerLabel?: string
}

export function ResourceAccessEditor({
  resourceType,
  draft,
  users,
  groups,
  busy = false,
  emptyOwnerLabel = "No owner",
}: ResourceAccessEditorProps) {
  const [query, setQuery] = useState("")
  const [filters, setFilters] = useState<Readonly<Partial<Record<Capability, FilterMode>>>>({})
  const [ownerMode, setOwnerMode] = useState(false)
  const [note, setNote] = useState("")
  const [principal, setPrincipal] = useState<Principal>("users")
  const [ownerOpen, setOwnerOpen] = useState(false)
  const [ownerQuery, setOwnerQuery] = useState("")
  const [ownerHighlight, setOwnerHighlight] = useState(0)

  const userSelection = useSelection<string>()
  const groupSelection = useSelection<string>()
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // The owner transfer is a single-pick user list, so it forces the user
  // catalog and hides the switch; the owner field below is separate.
  const active: Principal = ownerMode ? "users" : principal
  const activeSelection = active === "groups" ? groupSelection : userSelection
  const marquee = useMarqueeSelection(scrollRef, (keys) => activeSelection.setMany(keys))

  const ownerLabel = draft.owner === "" ? emptyOwnerLabel : usernameLabel(users, draft.owner)

  const groupById = useMemo(() => {
    const map = new Map<number, AccessGroup>()
    for (const group of groups) map.set(group.id, group)
    return map
  }, [groups])

  const ownerGroupIdSet = useMemo(() => new Set(draft.ownerGroups), [draft.ownerGroups])
  const everyoneOwned = draft.ownerGroups.some((id) => {
    const group = groupById.get(id)
    return group !== undefined && isEveryoneGroup(group)
  })

  const ownerOptions = useMemo(() => {
    const options: OwnerOption[] = [
      ...users
        .filter((user) => user.username !== draft.owner)
        .map((user) => ({
          kind: "user" as const,
          id: user.username,
          label: userLabel(user),
          detail: `@${user.username}`,
        })),
      ...groups
        .filter((group) => !ownerGroupIdSet.has(group.id))
        .map((group) => ({
          kind: "group" as const,
          id: String(group.id),
          label: groupLabel(group),
          detail: groupMembersLabel(group),
        })),
    ]
    return rankBySearch(options, ownerQuery, (option) => [option.label, option.detail])
  }, [users, groups, draft.owner, ownerGroupIdSet, ownerQuery])

  const ownerListOpen = ownerOpen && ownerOptions.length > 0
  const ownerHighlightIndex =
    ownerOptions.length === 0 ? 0 : Math.min(ownerHighlight, ownerOptions.length - 1)

  function applyOwnerOption(option: OwnerOption): void {
    if (busy) return
    if (option.kind === "user") draft.setOwner(option.id)
    else draft.addOwnerGroup(Number(option.id))
    setOwnerQuery("")
    setOwnerHighlight(0)
  }

  function onOwnerKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (ownerOptions.length === 0) return
      event.preventDefault()
      setOwnerOpen(true)
      const step = event.key === "ArrowDown" ? 1 : -1
      setOwnerHighlight(
        (current) => (current + step + ownerOptions.length) % ownerOptions.length,
      )
    } else if (event.key === "Enter") {
      const option = ownerOptions[ownerHighlightIndex]
      if (option === undefined) return
      event.preventDefault()
      applyOwnerOption(option)
    } else if (event.key === "Escape") {
      setOwnerQuery("")
      setOwnerOpen(false)
    }
  }

  const userCatalog = useMemo(() => {
    const pool = ownerMode ? users : users.filter((user) => user.username !== draft.owner)
    const ranked = rankBySearch(pool, query, (user) => [user.display_name, user.username])
    const chosen = Object.entries(filters) as [Capability, FilterMode][]
    if (ownerMode || chosen.length === 0) return ranked
    // Every active chip has to hold: a green chip requires the user to hold that
    // capability, a red one requires them not to.
    return ranked.filter((user) =>
      chosen.every(([capability, mode]) => {
        const holds = holdsCapability(draft.grants, capability, user.username)
        return mode === "include" ? holds : !holds
      }),
    )
  }, [users, query, ownerMode, filters, draft.owner, draft.grants])

  const groupCatalog = useMemo(() => {
    const pool = groups.filter((group) => !ownerGroupIdSet.has(group.id))
    const ranked = rankBySearch(pool, query, (group) => [group.display_name, group.name])
    const chosen = Object.entries(filters) as [Capability, FilterMode][]
    if (chosen.length === 0) return ranked
    return ranked.filter((group) =>
      chosen.every(([capability, mode]) => {
        const holds = holdsGroupCapability(draft.groupGrants, capability, group.id)
        return mode === "include" ? holds : !holds
      }),
    )
  }, [groups, query, filters, ownerGroupIdSet, draft.groupGrants])

  const catalog = active === "groups" ? groupCatalog : userCatalog

  const counts = useMemo(() => {
    const result = {} as Record<Capability, number>
    for (const capability of CAPABILITIES) {
      result[capability] =
        active === "groups"
          ? groups.filter(
              (group) =>
                !ownerGroupIdSet.has(group.id) &&
                holdsGroupCapability(draft.groupGrants, capability, group.id),
            ).length
          : users.filter(
              (user) =>
                user.username !== draft.owner &&
                holdsCapability(draft.grants, capability, user.username),
            ).length
    }
    return result
  }, [active, users, groups, ownerGroupIdSet, draft.owner, draft.grants, draft.groupGrants])

  const offered = offeredCapabilities(resourceType)
  // A grant for a capability this type no longer offers predates the type filter,
  // so it still gets a lower-row chip (muted) — otherwise it could never be cleared.
  const legacy = CAPABILITIES.filter((capability) => {
    if (offered.includes(capability)) return false
    if (active === "groups") {
      return (draft.groupGrants[capability] ?? []).length > 0
    }
    return draft.grants[capability].length > 0
  })
  const filterCount = Object.keys(filters).length

  const selectedKeys =
    active === "groups"
      ? groups.filter((group) => groupSelection.selected.has(String(group.id))).map((group) => String(group.id))
      : users.filter((user) => userSelection.selected.has(user.username)).map((user) => user.username)

  function selectionState(capability: Capability): "all" | "partial" | "none" {
    if (selectedKeys.length === 0) return "none"
    const holds =
      active === "groups"
        ? (key: string) => holdsGroupCapability(draft.groupGrants, capability, Number(key))
        : (key: string) => holdsCapability(draft.grants, capability, key)
    const holding = selectedKeys.filter(holds).length
    if (holding === 0) return "none"
    return holding === selectedKeys.length ? "all" : "partial"
  }

  function clearSelection(): void {
    activeSelection.clear()
    setNote("")
  }

  function cycleFilter(capability: Capability): void {
    setFilters((current) => {
      const next = { ...current }
      if (current[capability] === undefined) next[capability] = "include"
      else if (current[capability] === "include") next[capability] = "exclude"
      else delete next[capability]
      return next
    })
  }

  function clearFilters(): void {
    setFilters({})
  }

  function switchPrincipal(next: Principal): void {
    setPrincipal(next)
    setNote("")
  }

  function toggleCapability(capability: Capability): void {
    const turnOn = selectionState(capability) !== "all"
    if (!turnOn && capability === "VIEW") {
      const losesMore =
        active === "groups"
          ? selectedKeys.some((key) =>
              CAPABILITIES.some(
                (candidate) =>
                  candidate !== "VIEW" && (draft.groupGrants[candidate] ?? []).includes(Number(key)),
              ),
            )
          : selectedKeys.some((username) =>
              CAPABILITIES.some(
                (candidate) => candidate !== "VIEW" && draft.grants[candidate].includes(username),
              ),
            )
      setNote(losesMore ? "Clearing View access also clears every other capability." : "")
    } else {
      setNote("")
    }
    for (const key of selectedKeys) {
      if (active === "groups") {
        const groupId = Number(key)
        if (turnOn) draft.grantGroup(capability, groupId)
        else draft.revokeGroup(capability, groupId)
      } else if (turnOn) {
        draft.grant(capability, key)
      } else {
        draft.revoke(capability, key)
      }
    }
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-md border border-line-subtle bg-surface-1 px-2.5 py-1.5">
        <div className="flex items-center gap-2">
          <IconCrown size={16} className="text-warning" />
          <Avatar name={ownerLabel} small />
          <span className="min-w-0 flex-1 truncate text-base">
            {ownerLabel}
            {draft.owner !== "" && draft.ownerMissing ? <span className="text-danger"> · missing</span> : null}
          </span>
          {ownerMode ? (
            <>
              <span className="text-sm whitespace-nowrap text-ink-muted">Pick the new owner</span>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOwnerMode(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setOwnerMode(true)
                setNote("")
              }}
            >
              Change
            </Button>
          )}
        </div>

        {ownerMode ? null : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-2xs uppercase tracking-wide text-ink-dim">Owner groups</span>
            {draft.ownerGroups.map((groupId) => {
              const group = groupById.get(groupId)
              const label = group === undefined ? `#${groupId}` : groupLabel(group)
              return (
                <span
                  key={groupId}
                  className="inline-flex h-7 items-center gap-1 rounded-full border border-line bg-surface-2 pr-1 pl-2"
                >
                  <IconUser size={14} className="text-ink-dim" />
                  <span className="max-w-[12rem] truncate text-sm">{label}</span>
                  <IconButton
                    label={`Remove owner group ${label}`}
                    icon={<IconX size={14} />}
                    size="sm"
                    disabled={busy}
                    onClick={() => draft.removeOwnerGroup(groupId)}
                  />
                </span>
              )
            })}
            <div className="min-w-[200px] flex-1">
              <Input
                type="search"
                autoComplete="off"
                value={ownerQuery}
                placeholder="Add a user or group as owner…"
                aria-label="Add an owner"
                role="combobox"
                aria-expanded={ownerListOpen}
                aria-controls={ownerListOpen ? OWNER_LIST_ID : undefined}
                aria-autocomplete="list"
                aria-activedescendant={
                  ownerListOpen
                    ? `${OWNER_LIST_ID}-${ownerOptions[ownerHighlightIndex].kind}-${ownerOptions[ownerHighlightIndex].id}`
                    : undefined
                }
                disabled={busy}
                onChange={(event) => {
                  setOwnerQuery(event.target.value)
                  setOwnerOpen(true)
                  setOwnerHighlight(0)
                }}
                onFocus={() => setOwnerOpen(true)}
                onBlur={() => setOwnerOpen(false)}
                onKeyDown={onOwnerKeyDown}
              />
            </div>
          </div>
        )}

        {ownerMode || !ownerOpen ? null : (
          <div className="rounded-md border border-line-subtle bg-surface-2 p-2">
            {ownerOptions.length === 0 ? (
              <p className="text-sm text-ink-muted">No users or groups match.</p>
            ) : (
              <ul
                id={OWNER_LIST_ID}
                role="listbox"
                aria-label="Users and groups to own this item"
                className="flex max-h-64 flex-col gap-0.5 overflow-y-auto"
              >
                {ownerOptions.map((option, index) => (
                  <li
                    key={`${option.kind}-${option.id}`}
                    id={`${OWNER_LIST_ID}-${option.kind}-${option.id}`}
                    role="option"
                    aria-selected={index === ownerHighlightIndex}
                    className={cn(
                      "flex cursor-pointer items-center justify-between gap-3 rounded px-2 py-1.5 text-sm",
                      index === ownerHighlightIndex ? "bg-surface-1 text-ink" : "text-ink-muted",
                    )}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setOwnerHighlight(index)}
                    onClick={() => applyOwnerOption(option)}
                  >
                    <span className="truncate">{option.label}</span>
                    <span className="shrink-0 text-2xs text-ink-dim">{option.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {everyoneOwned ? (
          <p
            role="alert"
            className="rounded-md border border-danger bg-danger-dim px-2.5 py-1.5 text-sm text-danger"
          >
            {EVERYONE_OWNER_WARNING}
          </p>
        ) : null}
      </div>

      {ownerMode ? null : (
        <div role="group" aria-label="Principal" className="flex flex-wrap items-center gap-2">
          {(["users", "groups"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={principal === value}
              disabled={busy}
              className={cn(CHIP_BASE, principal === value ? CHIP_ON : CHIP_OFF)}
              onClick={() => switchPrincipal(value)}
            >
              {value === "users" ? "Users" : "Groups"}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[160px] flex-1">
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
            placeholder={active === "groups" ? "Search groups…" : "Search users…"}
            aria-label={active === "groups" ? "Search groups" : "Search users"}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {ownerMode ? null : (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || catalog.length === 0}
              onClick={() =>
                activeSelection.setMany(
                  active === "groups"
                    ? groupCatalog.map((group) => String(group.id))
                    : userCatalog.map((user) => user.username),
                )
              }
            >
              Select all
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || selectedKeys.length === 0}
              onClick={clearSelection}
            >
              Clear
            </Button>
          </>
        )}
      </div>

      {ownerMode ? null : (
        <div role="group" aria-label="Filter by capability" className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={filterCount === 0}
            disabled={busy}
            className={cn(CHIP_BASE, filterCount === 0 ? CHIP_ON : CHIP_OFF)}
            onClick={clearFilters}
          >
            All
          </button>
          {offered.map((capability) => {
            const mode = filters[capability]
            return (
              <button
                key={capability}
                type="button"
                aria-pressed={mode === "include" ? true : mode === "exclude" ? "mixed" : false}
                disabled={busy}
                title={
                  mode === "include"
                    ? "Only users who hold this — click to exclude it instead."
                    : mode === "exclude"
                      ? "Only users who do not hold this — click to clear."
                      : "Only users who hold this."
                }
                className={cn(
                  CHIP_BASE,
                  mode === "include" ? CHIP_ON : mode === "exclude" ? CHIP_EXCLUDE : CHIP_OFF,
                )}
                onClick={() => cycleFilter(capability)}
              >
                {capabilityLabel(capability)}
                <Badge variant="neutral">{counts[capability]}</Badge>
              </button>
            )
          })}
        </div>
      )}

      <div
        ref={scrollRef}
        data-testid="access-catalog"
        className="relative max-h-[calc(100dvh-520px)] min-h-[120px] flex-1 overflow-y-auto rounded-md border border-line-subtle bg-surface-1 p-2 select-none touch-pan-y"
      >
        {catalog.length === 0 ? (
          <p className="p-2 text-sm text-ink-muted">
            {active === "groups" ? "No groups match." : "No users match."}
          </p>
        ) : active === "groups" ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {groupCatalog.map((group) => {
              const key = String(group.id)
              const selected = groupSelection.selected.has(key)
              return (
                <button
                  key={group.id}
                  type="button"
                  data-marquee-key={key}
                  data-granted={selected}
                  aria-pressed={selected}
                  disabled={busy}
                  onClick={() => groupSelection.toggle(key)}
                  className={cn(CARD_CLASS, selected && CARD_SELECTED_CLASS)}
                >
                  <span className="w-full truncate text-sm">{group.name}</span>
                  <span className="w-full truncate text-2xs text-ink-dim">{group.display_name}</span>
                  <span className="w-full truncate text-2xs text-ink-muted">{groupMembersLabel(group)}</span>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {userCatalog.map((user) => {
              const selected = ownerMode ? draft.owner === user.username : userSelection.selected.has(user.username)
              return (
                <button
                  key={user.username}
                  type="button"
                  data-marquee-key={user.username}
                  data-granted={selected}
                  aria-pressed={selected}
                  disabled={busy}
                  onClick={() =>
                    ownerMode ? draft.setOwner(user.username) : userSelection.toggle(user.username)
                  }
                  className={cn(CARD_CLASS, selected && CARD_SELECTED_CLASS)}
                >
                  <Avatar name={userLabel(user)} />
                  <span className="w-full truncate text-sm">{userLabel(user)}</span>
                  <span className="w-full truncate text-2xs text-ink-dim [font-family:var(--font-mono)]">
                    @{user.username}
                  </span>
                </button>
              )
            })}
          </div>
        )}
        {marquee.overlay === null ? null : (
          <div
            className="pointer-events-none absolute rounded-xs border border-brand bg-[var(--accent-dim)]"
            style={{
              left: marquee.overlay.left,
              top: marquee.overlay.top,
              width: marquee.overlay.width,
              height: marquee.overlay.height,
            }}
            aria-hidden="true"
          />
        )}
      </div>

      {ownerMode ? null : (
        <>
          <div className="flex items-center justify-between gap-2 text-sm" aria-live="polite">
            <span className="text-ink-muted">{`${selectedKeys.length} selected`}</span>
            {note === "" ? null : <span className="text-warning">{note}</span>}
          </div>
          <div
            role="group"
            aria-label="Capabilities for the selected users"
            className="flex flex-wrap items-center gap-2"
          >
            {[...offered, ...legacy].map((capability) => {
              const state = selectionState(capability)
              const retired = !offered.includes(capability)
              return (
                <button
                  key={capability}
                  type="button"
                  aria-pressed={state === "all" ? true : state === "partial" ? "mixed" : false}
                  disabled={busy || selectedKeys.length === 0}
                  title={retired ? "Not offered for this item type — clear it here." : undefined}
                  className={cn(
                    CHIP_BASE,
                    state === "all" ? CHIP_ON : state === "partial" ? CHIP_PARTIAL : CHIP_OFF,
                    retired && "border-dashed",
                  )}
                  onClick={() => toggleCapability(capability)}
                >
                  {state === "all" ? <IconCheck size={14} /> : null}
                  {capabilityLabel(capability)}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

export interface ResourceAccessFieldsProps {
  readonly resourceType: string
  readonly access: ItemAccess
  readonly users: readonly User[]
  readonly groups: readonly AccessGroup[]
  readonly busy?: boolean
  readonly onApply: (target: AccessTarget & GroupDraftTarget) => void
  readonly applyLabel?: string
}

/**
 * The settings-dialog body: the shared editor plus its inline status/apply
 * footer. `AccessPanel` renders the same editor and pins the equivalent footer
 * in its `Dialog` footer instead.
 */
export function ResourceAccessFields({
  resourceType,
  access,
  users,
  groups,
  busy = false,
  onApply,
  applyLabel = "Apply changes",
}: ResourceAccessFieldsProps) {
  const draft = useAccessDraft(access)
  return (
    <div className="flex flex-col gap-4">
      <ResourceAccessEditor
        resourceType={resourceType}
        draft={draft}
        users={users}
        groups={groups}
        busy={busy}
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted">{draft.dirty ? "Unsaved changes" : "Up to date"}</span>
        <Button
          size="sm"
          variant="primary"
          loading={busy}
          disabled={!draft.dirty || busy}
          onClick={() => onApply(draft.target)}
        >
          {applyLabel}
        </Button>
      </div>
    </div>
  )
}
