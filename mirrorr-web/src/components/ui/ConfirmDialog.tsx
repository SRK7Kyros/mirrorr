import { useId, useRef, useState } from "react"
import type { ReactNode } from "react"
import { Button } from "./Button"
import { Dialog } from "./Dialog"
import { Input } from "./Input"

export type ConfirmTone = "default" | "destructive" | "block"

export interface TypedConfirm {
  /** Exact phrase the user must type. */
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
  /** Adds the mono phrase-confirmation input; confirm stays disabled until it matches. */
  readonly typedConfirm?: TypedConfirm
}

/**
 * ConfirmDialog — §6.4: as dialog plus the consequence stated verbatim. Focus
 * starts on Cancel (safe default, §8.4). `destructive` uses the danger button
 * and a warning-tinted body; `block` shows a single Close and no confirm;
 * typedConfirm gates the confirm on an exact phrase. Confirm shows a spinner
 * while busy and the dialog stays open with detail on error.
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
  const cancelRef = useRef<HTMLButtonElement>(null)
  const [typedValue, setTypedValue] = useState("")

  const phraseMatches = typedConfirm === undefined || typedValue.trim() === typedConfirm.phrase
  const canConfirm = phraseMatches && !loading
  const typedMismatch = typedConfirm !== undefined && typedValue.length > 0 && !phraseMatches

  const close = () => {
    setTypedValue("")
    onClose()
  }

  const footer = (
    <>
      <Button ref={cancelRef} variant="ghost" onClick={close}>
        {tone === "block" ? confirmLabel : cancelLabel}
      </Button>
      {tone !== "block" ? (
        <Button
          variant={tone === "destructive" ? "danger" : "primary"}
          loading={loading}
          disabled={!canConfirm}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      ) : null}
    </>
  )

  return (
    <Dialog open={open} onClose={close} title={title} footer={footer} initialFocusRef={cancelRef}>
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
