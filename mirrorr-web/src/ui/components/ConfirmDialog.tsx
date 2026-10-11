import { useState, type ReactNode } from "react"
import { Button } from "./Button"
import { Dialog } from "./Dialog"
import { IconAlert } from "./icons"

export interface ConfirmDialogProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly onConfirm: () => void | Promise<void>
  readonly title: ReactNode
  readonly description?: ReactNode
  readonly confirmLabel?: string
  readonly cancelLabel?: string
  readonly danger?: boolean
  readonly children?: ReactNode
}

/**
 * Destructive-action confirmation — a `Dialog` with the danger icon plate.
 * Awaits `onConfirm`, holds the button in a loading state, then closes.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = true,
  children,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    setBusy(true)
    try {
      await onConfirm()
      onClose()
    } catch (error) {
      console.warn("Confirm action failed", error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      title={title}
      description={description}
      icon={
        danger ? (
          <span className="dialog-icon-danger" aria-hidden="true">
            <IconAlert size={20} />
          </span>
        ) : undefined
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={() => void confirm()} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  )
}
