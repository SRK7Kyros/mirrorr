import { useEffect, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/Button"
import { Dialog } from "@/components/ui/Dialog"
import { Input } from "@/components/ui/Input"

/**
 * ConfirmDialog — spec L112 + L405: 400px, danger primary button for
 * destructive actions, optional typed-confirmation input, focus-trapped with
 * Esc cancelling. Typed confirmation is opt-in and only delete-user and
 * revoke-key pass it (spec L112/L550).
 */

export interface ConfirmDialogProps {
  readonly open: boolean
  readonly title: string
  readonly body: ReactNode
  readonly confirmLabel?: string
  readonly cancelLabel?: string
  readonly danger?: boolean
  readonly pending?: boolean
  /** When set, confirm stays disabled until the input matches exactly. */
  readonly typedConfirmation?: string
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = true,
  pending = false,
  typedConfirmation,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("")

  useEffect(() => {
    if (open) setTyped("")
  }, [open])

  const confirmed = typedConfirmation === undefined || typed === typedConfirmation

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      size="confirm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            onClick={onConfirm}
            disabled={!confirmed || pending}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div>{body}</div>
        {typedConfirmation !== undefined ? (
          <Input
            label={`Type ${typedConfirmation} to confirm`}
            value={typed}
            autoComplete="off"
            onChange={(event) => setTyped(event.target.value)}
          />
        ) : null}
      </div>
    </Dialog>
  )
}
