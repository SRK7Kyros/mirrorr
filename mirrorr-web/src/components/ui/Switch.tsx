import { useId } from "react"
import { Spinner } from "./Spinner"

export interface SwitchProps {
  readonly checked: boolean
  readonly onChange: (next: boolean) => void
  readonly label: string
  /** Visible disabled reason (§4: never hidden — 12px muted twin of any tooltip). */
  readonly disabledReason?: string
  readonly disabled?: boolean
  /** Pending: thumb → 12px spinner, track stays at target color, no toggle (§4). */
  readonly pending?: boolean
  readonly id?: string
  /** Optional visible row label rendered beside the track. */
  readonly showLabel?: boolean
}

/**
 * Switch — §4 matrix: off (raised track + standard border, thumb left) ·
 * on (`#0C5CAB`, thumb right) · disabled-but-visible (fill-hover track,
 * muted thumb + visible reason text) · pending (spinner replaces thumb).
 * 32×18 desktop / 44×24 compact, 44px hit area throughout.
 * While pending the caller owns the optimistic target via `checked` — the
 * track reflects that target color until the real state flips back.
 */
export function Switch({
  checked,
  onChange,
  label,
  disabledReason,
  disabled = false,
  pending = false,
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
        aria-describedby={disabledReason !== undefined ? reasonId : undefined}
        data-pending={pending || undefined}
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
