import { useId, useState } from "react"
import type { ReactNode } from "react"
import { IconX } from "./icons"

export function TagInput({
  id,
  label,
  helper,
  error,
  value,
  disabled,
  onChange,
}: {
  id: string
  label: string
  helper?: string
  error?: string
  value: readonly unknown[]
  disabled: boolean
  onChange: (next: unknown) => void
}) {
  const [draft, setDraft] = useState("")
  const helperId = `${id}-helper`
  const chips = value.map((entry) => Number(entry)).filter((n) => Number.isFinite(n))

  const commit = (raw: string) => {
    const trimmed = raw.trim()
    if (trimmed === "") return
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed)) return
    if (chips.includes(parsed)) {
      setDraft("")
      return
    }
    onChange([...chips, parsed])
    setDraft("")
  }

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="tag-input">
        {chips.map((chip) => (
          <span key={chip} className="tag-input__chip">
            <span className="t-mono-inline num">{chip}</span>
            <button
              type="button"
              className="tag-input__remove"
              aria-label={`Remove ${String(chip)}`}
              disabled={disabled}
              onClick={() => onChange(chips.filter((entry) => entry !== chip))}
            >
              <IconX size={12} />
            </button>
          </span>
        ))}
        <input
          id={id}
          className="input"
          type="number"
          inputMode="numeric"
          disabled={disabled}
          aria-describedby={helper ?? error ? helperId : undefined}
          aria-invalid={error !== undefined || undefined}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              commit(draft)
            }
            if (event.key === "Backspace" && draft === "" && chips.length > 0) {
              onChange(chips.slice(0, -1))
            }
          }}
        />
      </div>
      {(helper !== undefined || error !== undefined) && (
        <span id={helperId} className={error ? "field__helper field__helper--error" : "field__helper"}>
          {error ?? helper}
        </span>
      )}
    </div>
  )
}

export function SchemaGroup({ legend, children }: { legend: string; children: ReactNode }) {
  const groupId = useId()
  return (
    <div className="schema-group">
      <details>
        <summary className="schema-group__toggle" id={groupId}>
          {legend}
        </summary>
        <div className="stack" style={{ gap: "var(--space-smd)" }}>
          {children}
        </div>
      </details>
    </div>
  )
}
