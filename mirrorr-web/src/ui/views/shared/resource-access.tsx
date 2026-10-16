import { useId, useMemo, useRef, useState } from "react"
import {
  type AccessOverride,
  type AccessTarget,
  type ItemAccess,
} from "@/api/domain/access-plan"
import { CAPABILITIES, type Capability } from "@/api/schemas/privileged"
import type { User } from "@/api/schemas/user"
import { Button, Field, IconButton, Select } from "@/ui/components"
import { IconPlus, IconX } from "@/ui/components/icons"

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

export function ownerOptions(users: readonly User[], owner: string): { value: string; label: string }[] {
  const options = users.map((user) => ({ value: user.username, label: userLabel(user) }))
  if (owner !== "" && !users.some((user) => user.username === owner)) {
    options.unshift({ value: owner, label: `${owner} (missing)` })
  }
  return options
}

export function overrideLabel(override: AccessOverride): string {
  if (override.kind === "owner-missing") return "Owner account missing"
  return override.count === 1 ? "1 view grant" : `${override.count} view grants`
}

/**
 * Section headings, in the frozen `CAPABILITIES` order. Only `VIEW` keeps its
 * established copy ("View access") — the e2e and unit specs pin that exact
 * string, so renaming it is a contract change, not a wording preference.
 */
const CAPABILITY_LABEL: Record<Capability, string> = {
  VIEW: "View access",
  OPERATE: "Operate",
  EDIT: "Edit",
  DELETE: "Delete",
  SHARE: "Share",
  EXPORT: "Export",
}

function grantCapability(access: ItemAccess, capability: Capability, username: string): ItemAccess {
  if (access.grants[capability].includes(username)) return access
  return {
    ...access,
    grants: { ...access.grants, [capability]: [...access.grants[capability], username] },
  }
}

function revokeCapability(access: ItemAccess, capability: Capability, username: string): ItemAccess {
  if (!access.grants[capability].includes(username)) return access
  return {
    ...access,
    grants: {
      ...access.grants,
      [capability]: access.grants[capability].filter((candidate) => candidate !== username),
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
  readonly grants: Readonly<Record<Capability, readonly string[]>>
  readonly dirty: boolean
  readonly target: AccessTarget
  readonly setOwner: (username: string) => void
  readonly grant: (capability: Capability, username: string) => void
  readonly revoke: (capability: Capability, username: string) => void
}

/**
 * Capability-aware draft. Every section reads and edits one capability list,
 * and `target.grants` carries the whole record so the planner diffs it against
 * the loaded access. The `accessSignature` guard reloads the draft whenever the
 * `access` prop really changes — the signature covers the owner, ownerMissing
 * and all six capability lists, so an equal prop leaves in-flight edits intact.
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
    grants: draft.grants,
    dirty: accessSignature(draft) !== signature,
    target: { owner: draft.owner ?? undefined, grants: draft.grants },
    setOwner: (username) => setDraft((current) => ({ ...current, owner: username })),
    grant: (capability, username) => setDraft((current) => grantCapability(current, capability, username)),
    revoke: (capability, username) => setDraft((current) => revokeCapability(current, capability, username)),
  }
}

interface CapabilitySectionProps {
  readonly capability: Capability
  readonly users: readonly User[]
  readonly granted: readonly string[]
  readonly busy: boolean
  readonly onGrant: (username: string) => void
  readonly onRevoke: (username: string) => void
}

/**
 * One capability's user list: a `Remove <username>` control per granted user,
 * then a user picker + `Add` to grant. The standard capability keeps the
 * established accessible names ("Add a viewer" / "Remove <username>" / "Add");
 * the others are named "<verb> <Capability>" so they never collide with the
 * exact-name lookups the existing specs rely on.
 */
function CapabilitySection({
  capability,
  users,
  granted,
  busy,
  onGrant,
  onRevoke,
}: CapabilitySectionProps) {
  const [selected, setSelected] = useState("")
  const label = CAPABILITY_LABEL[capability]
  const addable = users.filter((user) => !granted.includes(user.username))
  const isView = capability === "VIEW"

  return (
    <div className="flex flex-col gap-2">
      <span className="text-muted">{label}</span>
      {granted.length === 0 ? (
        isView ? <p className="text-muted">Only the owner can see this item.</p> : null
      ) : (
        <ul className="flex flex-col gap-2">
          {granted.map((username) => (
            <li key={username} className="flex items-center justify-between gap-3">
              <span className="text-truncate">{usernameLabel(users, username)}</span>
              <IconButton
                label={`Remove ${username}`}
                icon={<IconX size={16} />}
                variant="danger-ghost"
                size="sm"
                disabled={busy}
                onClick={() => onRevoke(username)}
              />
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <Select
          aria-label={isView ? "Add a viewer" : `Add user to ${label}`}
          value={selected}
          disabled={busy}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">Select a user…</option>
          {addable.map((user) => (
            <option key={user.username} value={user.username}>
              {userLabel(user)}
            </option>
          ))}
        </Select>
        <Button
          size="sm"
          variant="secondary"
          icon={<IconPlus size={15} />}
          aria-label={isView ? undefined : `Add to ${label}`}
          disabled={selected === "" || busy}
          onClick={() => {
            onGrant(selected)
            setSelected("")
          }}
        >
          Add
        </Button>
      </div>
    </div>
  )
}

export interface ResourceAccessFieldsProps {
  readonly access: ItemAccess
  readonly users: readonly User[]
  readonly busy?: boolean
  readonly onApply: (target: AccessTarget) => void
  readonly applyLabel?: string
}

export function ResourceAccessFields({
  access,
  users,
  busy = false,
  onApply,
  applyLabel = "Apply changes",
}: ResourceAccessFieldsProps) {
  const draft = useAccessDraft(access)
  const ownerId = useId()
  const options = useMemo(() => ownerOptions(users, draft.owner), [users, draft.owner])

  return (
    <div className="flex flex-col gap-4">
      <Field label="Owner" htmlFor={ownerId}>
        <Select
          id={ownerId}
          value={draft.owner}
          disabled={busy}
          onChange={(event) => draft.setOwner(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>

      {CAPABILITIES.map((capability) => (
        <CapabilitySection
          key={capability}
          capability={capability}
          users={users}
          granted={draft.grants[capability]}
          busy={busy}
          onGrant={(username) => draft.grant(capability, username)}
          onRevoke={(username) => draft.revoke(capability, username)}
        />
      ))}

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
