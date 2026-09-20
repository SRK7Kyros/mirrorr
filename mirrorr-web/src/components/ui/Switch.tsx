/**
 * Switch — the accessible boolean control for D1's recording toggle.
 *
 * Contract: `docs/web-frontend-spec.md` L401 — the recording control is a
 * switch that stays visible but `disabled` when the engine reports
 * `can_record:false`, with the tooltip "Engine cannot record" (never hidden).
 * L218: recording enable/disable shows a spinner until the WS flip confirms.
 */
import { Loader2 } from "lucide-react"
import type { ReactNode } from "react"

export interface SwitchProps {
  readonly checked: boolean
  readonly onCheckedChange: (checked: boolean) => void
  readonly label: string
  readonly disabled?: boolean
  readonly disabledReason?: string
  readonly pending?: boolean
  readonly hint?: ReactNode
}

export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled = false,
  disabledReason,
  pending = false,
  hint,
}: SwitchProps) {
  const title = disabled && disabledReason ? disabledReason : undefined

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        title={title}
        disabled={disabled || pending}
        onClick={() => onCheckedChange(!checked)}
        className="inline-flex shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span
          className={`inline-flex h-4 w-7 items-center rounded-full border px-0.5 transition-colors duration-100 ${
            checked ? "border-accent bg-accent" : "border-border-strong bg-bg-inset"
          }`}
        >
          <span
            data-testid={pending ? "switch-pending" : "switch-knob"}
            className={`flex size-3 items-center justify-center rounded-full bg-bg-base transition-transform duration-100 ${
              checked ? "translate-x-3" : "translate-x-0"
            }`}
          >
            {pending ? <Loader2 aria-hidden="true" className="size-2 animate-spin text-text-muted" /> : null}
          </span>
        </span>
      </button>
      <span className="text-body text-text-secondary">{label}</span>
      {hint}
    </div>
  )
}
