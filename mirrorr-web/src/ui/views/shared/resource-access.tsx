import { useId, useMemo, useRef, useState } from "react"
import type { AccessOverride, AccessTarget, ItemAccess } from "@/api/domain/access-plan"
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

function accessSignature(access: ItemAccess): string {
  return `${access.owner}\u0000${[...access.viewers].sort().join("\u0000")}`
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

export function useAccessDraft(access: ItemAccess): AccessDraft {
  const [draft, setDraft] = useState<ItemAccess>(access)
  const loaded = useRef(accessSignature(access))
  const signature = accessSignature(access)
  if (loaded.current !== signature) {
    loaded.current = signature
    setDraft(access)
  }

  return {
    owner: draft.owner,
    viewers: draft.viewers,
    dirty: accessSignature(draft) !== signature,
    target: { owner: draft.owner, viewers: draft.viewers },
    setOwner: (username) => setDraft((current) => ({ ...current, owner: username })),
    addViewer: (username) =>
      setDraft((current) =>
        current.viewers.includes(username)
          ? current
          : { ...current, viewers: [...current.viewers, username] },
      ),
    removeViewer: (username) =>
      setDraft((current) => ({
        ...current,
        viewers: current.viewers.filter((viewer) => viewer !== username),
      })),
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
