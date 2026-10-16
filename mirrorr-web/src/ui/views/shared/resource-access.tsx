import { useMemo, useRef, useState } from "react"
import {
  type AccessOverride,
  type AccessTarget,
  type ItemAccess,
} from "@/api/domain/access-plan"
import { rankBySearch } from "@/api/domain/search"
import { CAPABILITIES, type Capability } from "@/api/schemas/privileged"
import type { User } from "@/api/schemas/user"
import { Avatar, Badge, Button, Input } from "@/ui/components"
import { IconCheck, IconCrown, IconSearch } from "@/ui/components/icons"
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
  return override.count === 1 ? "1 user with access" : `${override.count} users with access`
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

function accessSignature(access: ItemAccess): string {
  const grants = CAPABILITIES.map(
    (capability) => `${capability}:${[...access.grants[capability]].sort().join(",")}`,
  ).join("\u0001")
  return `${access.owner ?? ""}\u0000${access.ownerMissing}\u0000${grants}`
}

export interface AccessDraft {
  readonly owner: string
  readonly ownerMissing: boolean
  readonly grants: Readonly<Record<Capability, readonly string[]>>
  readonly dirty: boolean
  readonly target: AccessTarget
  readonly setOwner: (username: string) => void
  readonly grant: (capability: Capability, username: string) => void
  readonly revoke: (capability: Capability, username: string) => void
}

/**
 * Capability-aware draft. The whole editor reads one `grants` record and edits
 * it through `grant`/`revoke`; `target.grants` carries the record so the planner
 * diffs it against the loaded access. The `accessSignature` guard reloads the
 * draft whenever the `access` prop really changes — the signature covers the
 * owner, ownerMissing and all six capability lists, so an equal prop leaves
 * in-flight edits intact.
 */
export function useAccessDraft(access: ItemAccess): AccessDraft {
  const [draft, setDraft] = useState<ItemAccess>(access)
  const loaded = useRef(accessSignature(access))
  const signature = accessSignature(access)
  if (loaded.current !== signature) {
    loaded.current = signature
    setDraft(access)
  }

  return {
    owner: draft.owner ?? "",
    ownerMissing: draft.ownerMissing,
    grants: draft.grants,
    dirty: accessSignature(draft) !== signature,
    target: { owner: draft.owner ?? undefined, grants: draft.grants },
    setOwner: (username) => setDraft((current) => ({ ...current, owner: username })),
    grant: (capability, username) => setDraft((current) => grantCapability(current, capability, username)),
    revoke: (capability, username) => setDraft((current) => revokeCapability(current, capability, username)),
  }
}

/* ── the one editor ────────────────────────────────────────────────────
 *
 * Both surfaces (the per-item `AccessPanel` and the settings
 * `ResourceAccessDialog` through `ResourceAccessFields`) render this, so they
 * cannot drift. One catalog of avatar+name cards, one search box, one upper
 * chip row that filters the catalog to a capability's holders, and one lower
 * chip row that applies a capability set to the selected cards.
 */

const CARD_CLASS =
  "flex flex-col items-center gap-2 rounded-md border border-line bg-surface-2 p-2 text-center transition-colors " +
  "[&:hover:not(:disabled)]:border-line-strong [&:hover:not(:disabled)]:bg-surface-3 disabled:opacity-45"

const CARD_SELECTED_CLASS = "data-[granted=true]:border-brand data-[granted=true]:bg-[var(--accent-dim)]"

const CHIP_BASE =
  "inline-flex shrink-0 items-center gap-1.5 h-7 rounded-full border px-3 text-sm font-medium whitespace-nowrap " +
  "transition-colors [&:hover:not(:disabled)]:border-line-strong disabled:opacity-45"

const CHIP_ON = "border-brand bg-[var(--accent-dim)] text-ink"
const CHIP_OFF = "border-line bg-surface-2 text-ink-muted"
const CHIP_PARTIAL = "border-brand border-dashed bg-transparent text-ink"
type FilterMode = "include" | "exclude"

// A capability chip cycles off → include (green) → exclude (red) → off: green
// keeps the users who hold the capability, red keeps the ones who do not.
const CHIP_EXCLUDE = "border-danger bg-danger-dim text-danger"

export interface ResourceAccessEditorProps {
  readonly resourceType: string
  readonly draft: AccessDraft
  readonly users: readonly User[]
  readonly busy?: boolean
}

export function ResourceAccessEditor({ resourceType, draft, users, busy = false }: ResourceAccessEditorProps) {
  const [query, setQuery] = useState("")
  const [filters, setFilters] = useState<Readonly<Partial<Record<Capability, FilterMode>>>>({})
  const [ownerMode, setOwnerMode] = useState(false)
  const [note, setNote] = useState("")

  const selection = useSelection<string>()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const marquee = useMarqueeSelection(scrollRef, (keys) => selection.setMany(keys))

  const ownerLabel = draft.owner === "" ? "No owner" : usernameLabel(users, draft.owner)

  const catalog = useMemo(() => {
    const pool = ownerMode ? users : users.filter((user) => user.username !== draft.owner)
    const ranked = rankBySearch(pool, query, (user) => [user.display_name, user.username])
    const active = Object.entries(filters) as [Capability, FilterMode][]
    if (ownerMode || active.length === 0) return ranked
    // Every active chip has to hold: a green chip requires the user to hold that
    // capability, a red one requires them not to.
    return ranked.filter((user) =>
      active.every(([capability, mode]) => {
        const holds = holdsCapability(draft.grants, capability, user.username)
        return mode === "include" ? holds : !holds
      }),
    )
  }, [users, query, ownerMode, filters, draft.owner, draft.grants])

  const counts = useMemo(() => {
    const result = {} as Record<Capability, number>
    for (const capability of CAPABILITIES) {
      result[capability] = users.filter(
        (user) => user.username !== draft.owner && holdsCapability(draft.grants, capability, user.username),
      ).length
    }
    return result
  }, [users, draft.owner, draft.grants])

  const offered = offeredCapabilities(resourceType)
  // A grant for a capability this type no longer offers predates the type filter,
  // so it still gets a lower-row chip (muted) — otherwise it could never be cleared.
  const legacy = CAPABILITIES.filter(
    (capability) => !offered.includes(capability) && draft.grants[capability].length > 0,
  )
  const filterCount = Object.keys(filters).length

  const selectedUsernames = users
    .filter((user) => selection.selected.has(user.username))
    .map((user) => user.username)

  function selectionState(capability: Capability): "all" | "partial" | "none" {
    if (selectedUsernames.length === 0) return "none"
    const holding = selectedUsernames.filter((username) =>
      holdsCapability(draft.grants, capability, username),
    ).length
    if (holding === 0) return "none"
    return holding === selectedUsernames.length ? "all" : "partial"
  }

  function clearSelection(): void {
    selection.clear()
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

  function toggleCapability(capability: Capability): void {
    const turnOn = selectionState(capability) !== "all"
    if (!turnOn && capability === "VIEW") {
      const losesMore = selectedUsernames.some((username) =>
        CAPABILITIES.some(
          (candidate) => candidate !== "VIEW" && draft.grants[candidate].includes(username),
        ),
      )
      setNote(losesMore ? "Clearing View access also clears every other capability." : "")
    } else {
      setNote("")
    }
    for (const username of selectedUsernames) {
      if (turnOn) draft.grant(capability, username)
      else draft.revoke(capability, username)
    }
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center gap-2 rounded-md border border-line-subtle bg-surface-1 px-2.5 py-1.5">
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
            placeholder="Search users…"
            aria-label="Search users"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {ownerMode ? null : (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || catalog.length === 0}
              onClick={() => selection.setMany(catalog.map((user) => user.username))}
            >
              Select all
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || selectedUsernames.length === 0}
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
          <p className="p-2 text-sm text-ink-muted">No users match.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {catalog.map((user) => {
              const selected = ownerMode ? draft.owner === user.username : selection.selected.has(user.username)
              return (
                <button
                  key={user.username}
                  type="button"
                  data-marquee-key={user.username}
                  data-granted={selected}
                  aria-pressed={selected}
                  disabled={busy}
                  onClick={() =>
                    ownerMode ? draft.setOwner(user.username) : selection.toggle(user.username)
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
            <span className="text-ink-muted">{`${selectedUsernames.length} selected`}</span>
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
                  disabled={busy || selectedUsernames.length === 0}
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
  readonly busy?: boolean
  readonly onApply: (target: AccessTarget) => void
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
  busy = false,
  onApply,
  applyLabel = "Apply changes",
}: ResourceAccessFieldsProps) {
  const draft = useAccessDraft(access)
  return (
    <div className="flex flex-col gap-4">
      <ResourceAccessEditor resourceType={resourceType} draft={draft} users={users} busy={busy} />
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
