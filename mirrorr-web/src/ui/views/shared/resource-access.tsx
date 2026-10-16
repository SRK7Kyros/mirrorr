import { useId, useMemo, useRef, useState } from "react"
import {
  grantedUsernames,
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
  readonly viewers: readonly string[]
  readonly dirty: boolean
  readonly target: AccessTarget
  readonly setOwner: (username: string) => void
  readonly addViewer: (username: string) => void
  readonly removeViewer: (username: string) => void
}

/**
 * Behavior-preserving bridge for this wave: today's flat viewer list maps onto
 * the VIEW capability (add = grant VIEW, remove = revoke VIEW), and the
 * rendered list is the union of usernames across every capability so a future
 * non-VIEW grant still shows as a row instead of vanishing.
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
    viewers: grantedUsernames(draft),
    dirty: accessSignature(draft) !== signature,
    target: { owner: draft.owner ?? undefined, grants: draft.grants },
    setOwner: (username) => setDraft((current) => ({ ...current, owner: username })),
    addViewer: (username) => setDraft((current) => grantCapability(current, "VIEW", username)),
    removeViewer: (username) => setDraft((current) => revokeCapability(current, "VIEW", username)),
  }
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
  const [addTarget, setAddTarget] = useState("")
  const ownerId = useId()
  const options = useMemo(() => ownerOptions(users, draft.owner), [users, draft.owner])
  const addable = users.filter((user) => !draft.viewers.includes(user.username))

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

      <div className="flex flex-col gap-2">
        <span className="text-muted">View access</span>
        {draft.viewers.length === 0 ? (
          <p className="text-muted">Only the owner can see this item.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {draft.viewers.map((viewer) => (
              <li key={viewer} className="flex items-center justify-between gap-3">
                <span className="text-truncate">{usernameLabel(users, viewer)}</span>
                <IconButton
                  label={`Remove ${viewer}`}
                  icon={<IconX size={16} />}
                  variant="danger-ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => draft.removeViewer(viewer)}
                />
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-2">
          <Select
            aria-label="Add a viewer"
            value={addTarget}
            disabled={busy}
            onChange={(event) => setAddTarget(event.target.value)}
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
            disabled={addTarget === "" || busy}
            onClick={() => {
              draft.addViewer(addTarget)
              setAddTarget("")
            }}
          >
            Add
          </Button>
        </div>
      </div>

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
