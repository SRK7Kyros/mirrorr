import { useId } from "react"
import { inheritedChainHint } from "@/api/domain/fallback-sources"
import type { Profile } from "@/api/schemas"
import { Field, IconArrowDown, IconArrowUp, IconButton, IconX, Select, Tag } from "@/ui/components"

export interface FallbackProfilesProps {
  readonly profiles: readonly Profile[]
  /** The primary profile's id as a string — never offered as a fallback. */
  readonly primaryId: string
  /** Profile ids in the order they are tried. */
  readonly value: readonly number[]
  readonly onChange: (next: number[]) => void
  readonly disabled?: boolean
}

function nameOf(profiles: readonly Profile[], id: number): string {
  return profiles.find((profile) => profile.id === id)?.name ?? `Profile ${id}`
}

function move(ids: readonly number[], from: number, to: number): number[] {
  if (to < 0 || to >= ids.length) return [...ids]
  const next = [...ids]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/**
 * Ordered list of profiles to try after the subject's own capture fails — an
 * autorun's run, or a session started from an engine and resolver. Order is the
 * chain, so each rung carries up/down; a profile already in the chain (or the
 * primary) is never offered twice — the server rejects both.
 */
export function FallbackProfiles({
  profiles,
  primaryId,
  value,
  onChange,
  disabled = false,
}: FallbackProfilesProps) {
  const selectId = useId()
  const available = profiles.filter(
    (profile) => String(profile.id) !== primaryId && !value.includes(profile.id),
  )
  const inherited = inheritedChainHint(
    profiles.find((profile) => String(profile.id) === primaryId)?.fallback_sources,
  )
  const base =
    value.length === 0
      ? "None — the session fails if its own capture does."
      : "Tried in this order, after its own capture."

  return (
    <Field
      label="Fallbacks"
      htmlFor={selectId}
      hint={inherited === null ? base : `${base} ${inherited}`}
    >
      <div className="flex flex-col gap-2">
        {value.length > 0 ? (
          <ol className="flex flex-wrap gap-2" aria-label="Fallback profiles, in order">
            {value.map((id, index) => {
              const name = nameOf(profiles, id)
              return (
                <li
                  key={id}
                  className="flex h-9 items-center gap-1 rounded-xs border border-line-subtle bg-surface-2 pl-1.5 pr-1"
                >
                  <Tag className="border-0 bg-transparent px-0 text-ink-dim">{index + 1}</Tag>
                  <span className="max-w-40 truncate text-sm text-ink">{name}</span>
                  <IconButton
                    label={`Move ${name} up`}
                    size="sm"
                    icon={<IconArrowUp size={13} />}
                    disabled={disabled || index === 0}
                    onClick={() => onChange(move(value, index, index - 1))}
                  />
                  <IconButton
                    label={`Move ${name} down`}
                    size="sm"
                    icon={<IconArrowDown size={13} />}
                    disabled={disabled || index === value.length - 1}
                    onClick={() => onChange(move(value, index, index + 1))}
                  />
                  <IconButton
                    label={`Remove ${name}`}
                    size="sm"
                    icon={<IconX size={13} />}
                    disabled={disabled}
                    onClick={() => onChange(value.filter((entry) => entry !== id))}
                  />
                </li>
              )
            })}
          </ol>
        ) : null}
        <Select
          id={selectId}
          value=""
          disabled={disabled || available.length === 0}
          aria-label="Add a fallback profile"
          onChange={(event) => {
            const picked = event.target.value
            if (picked === "") return
            onChange([...value, Number(picked)])
          }}
        >
          <option value="">
            {available.length === 0 ? "No other profiles" : "Add a fallback profile…"}
          </option>
          {available.map((profile) => (
            <option key={profile.id} value={String(profile.id)}>
              {profile.name}
            </option>
          ))}
        </Select>
      </div>
    </Field>
  )
}
