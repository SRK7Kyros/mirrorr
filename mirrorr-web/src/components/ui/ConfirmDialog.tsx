import { useId, useState } from "react"
import type { ReactNode } from "react"
import { Button } from "./Button"
import { Dialog } from "./Dialog"
import { Input } from "./Input"

export type ConfirmTone = "default" | "destructive" | "block"

export interface TypedConfirm {
  /** Exact phrase the user must type (V11 revoke key, V7 delete, …). */
  readonly phrase: string
  readonly instruction?: string
  readonly inputLabel?: string
}

export interface ConfirmDialogProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly onConfirm: () => void
  readonly title: string
  readonly body: ReactNode
  readonly confirmLabel: string
  readonly cancelLabel?: string
  readonly tone?: ConfirmTone
  readonly loading?: boolean
  /** Adds the mono phrase-confirmation input; confirm stays at 40% opacity (§4). */
  readonly typedConfirm?: TypedConfirm
}

/**
 * ConfirmDialog — §4 three shapes:
 * • standard (ghost Cancel + primary Confirm, secondary body copy)
 * • destructive (warning icon + title 14/500 `#FF6B77` + amber-tinted detail;
 *   rendered here as a tinted body via tone="destructive", danger button)
 * • block ("… still in use" + single Close → cancelLabel only, no confirm)
 * • typed-confirm: mono input must match `phrase` (leading/trailing space
 *   trimmed); Confirm is aria-disabled at 40% opacity until it matches.
 * Compact presentation is Dialog's sheet resolution (§6).
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "default",
  loading = false,
  typedConfirm,
}: ConfirmDialogProps) {
  const phraseId = useId()
  const [typedValue, setTypedValue] = useState("")

  const phraseMatches =
    typedConfirm === undefined || typedValue.trim() === typedConfirm.phrase
  const canConfirm = phraseMatches && !loading
  const typedMismatch =
    typedConfirm !== undefined && typedValue.length > 0 && !phraseMatches

  const close = () => {
    setTypedValue("")
    onClose()
  }

  const footer = (
    <>
      <Button variant="ghost" onClick={close}>
        {tone === "block" ? confirmLabel : cancelLabel}
      </Button>
      {tone !== "block" ? (
        <Button
          variant={tone === "destructive" ? "danger" : "primary"}
          loading={loading}
          aria-disabled={!canConfirm}
          onClick={() => {
            if (canConfirm) onConfirm()
          }}
        >
          {confirmLabel}
        </Button>
      ) : null}
    </>
  )

  return (
    <Dialog open={open} onClose={close} title={title} footer={footer}>
      <div className={tone === "destructive" ? "confirm__body confirm__body--destructive" : "confirm__body"}>
        {body}
      </div>
      {typedConfirm !== undefined ? (
        <Input
          id={phraseId}
          label={typedConfirm.inputLabel ?? `Type “${typedConfirm.phrase}” to confirm`}
          mono
          autoComplete="off"
          spellCheck={false}
          value={typedValue}
          error={typedMismatch ? "Phrase does not match" : undefined}
          helper={typedMismatch ? undefined : typedConfirm.instruction}
          onChange={(event) => setTypedValue(event.target.value)}
        />
      ) : null}
    </Dialog>
  )
}
