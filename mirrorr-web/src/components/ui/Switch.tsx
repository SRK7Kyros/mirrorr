import { useId } from "react"
import { Spinner } from "./Spinner"

export interface SwitchProps {
  readonly checked: boolean
  readonly onChange: (next: boolean) => void
  readonly label: string
  /** Visible disabled reason (§6.2: helper explains why, e.g. "Locked while this run is live."). */
  readonly disabledReason?: string
  readonly disabled?: boolean
  /** §6.2 pending: track shows the spinner glyph, no toggle. */
  readonly pending?: boolean
  /** §6.2 error: track fills danger-deep + inline copy (via disabledReason slot). */
  readonly error?: boolean
  readonly id?: string
  /** Optional visible row label rendered beside the track. */
  readonly showLabel?: boolean
}

/**
 * Switch — §6.2: 44×24 track, radius 4 (a control, not a card). off =
 * secondary@30% + white knob; on = primary track; the knob slides on the
 * `micro` token (CSS transition); disabled @20%; pending shows a spinner
 * glyph; error fills danger-deep. Always labelled — never colour-only (§8.4).
 */
export function Switch({
  checked,
  onChange,
  label,
  disabledReason,
  disabled = false,
  pending = false,
  error = false,
  id,
  showLabel = false,
}: SwitchProps) {
  const generatedId = useId()
  const switchId = id ?? generatedId
  const reasonId = `${switchId}-reason`
  const isDisabled = disabled || pending

  return (
    <span className="switch-wrap">
      <button
        type="button"
        role="switch"
        id={switchId}
        className="switch"
        aria-checked={checked}
        aria-disabled={isDisabled || undefined}
        aria-label={showLabel ? undefined : label}
        aria-invalid={error || undefined}
        aria-describedby={disabledReason !== undefined ? reasonId : undefined}
        data-pending={pending || undefined}
        data-error={error || undefined}
        onClick={() => {
          if (!isDisabled) onChange(!checked)
        }}
      >
        <span className="switch__track">
          <span className="switch__thumb" />
          {pending ? (
            <span className="switch__pending-spinner">
              <Spinner size="sm" />
            </span>
          ) : null}
        </span>
        {showLabel ? <span className="t-body-strong">{label}</span> : null}
      </button>
      {disabled && disabledReason !== undefined ? (
        <span id={reasonId} className="switch__reason">
          {disabledReason}
        </span>
      ) : null}
    </span>
  )
}
