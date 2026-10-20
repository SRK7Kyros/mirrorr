import { useState, type ReactNode } from "react"
import { Button } from "./Button"
import { Dialog } from "./Dialog"
import { IconAlert } from "./icons"
import { toast } from "./Toast"

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
      toast.error(
        "That didn't work",
        error instanceof Error && error.message !== "" ? error.message : "Please try again.",
      )
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
          <span className="grid place-content-center w-9 h-9 rounded-md bg-danger-dim text-danger shrink-0" aria-hidden="true">
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
