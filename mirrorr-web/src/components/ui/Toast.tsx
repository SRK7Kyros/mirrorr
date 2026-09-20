import { AlertTriangle, Info, X } from "lucide-react"
import { useSyncExternalStore } from "react"
import { Button } from "@/components/ui/Button"
import { FOCUS_RING } from "@/components/ui/focus-ring"
import { dismissToast, getToasts, subscribeToasts, type ToastMessage } from "@/lib/toast"

/**
 * Toast — spec L110: bottom-right stack, 320px wide, `bg-overlay` + border,
 * radius 6, icon + message + close. Toasts are `role="status"`; errors are
 * `role="alert"` and sticky until dismissed (the store owns the 5s timer for
 * non-errors). This is the single toast implementation: `src/lib/toast.ts` is
 * the store, this module is its only renderer.
 */

const NO_TOASTS: readonly ToastMessage[] = []

export interface ToastProps {
  readonly toast: ToastMessage
  readonly onDismiss: (id: number) => void
}

export function Toast({ toast, onDismiss }: ToastProps) {
  const isError = toast.tone === "error"

  return (
    <div
      data-testid="toast"
      role={isError ? "alert" : "status"}
      className="flex w-80 items-start gap-2 rounded-surface border border-border bg-bg-overlay px-3 py-2 text-small text-text-primary shadow-toast"
    >
      {isError ? (
        <AlertTriangle
          aria-hidden="true"
          strokeWidth={2}
          className="mt-0.5 size-[var(--icon-default)] shrink-0 text-danger"
        />
      ) : (
        <Info
          aria-hidden="true"
          strokeWidth={2}
          className="mt-0.5 size-[var(--icon-default)] shrink-0 text-accent"
        />
      )}
      <span className="flex-1">{toast.message}</span>
      {toast.action !== undefined ? (
        <a
          data-testid="toast-action"
          href={toast.action.href}
          target="_blank"
          rel="noopener noreferrer"
          className={`shrink-0 rounded-control px-1 text-small font-medium text-accent hover:underline ${FOCUS_RING}`}
        >
          {toast.action.label}
        </a>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        icon={X}
        aria-label="Dismiss notification"
        title="Dismiss notification"
        onClick={() => onDismiss(toast.id)}
        className="-mt-0.5 -mr-1"
      />
    </div>
  )
}

export function ToastViewport() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, () => NO_TOASTS)

  if (toasts.length === 0) return null

  return (
    <div
      data-testid="toast-viewport"
      className="compact-toast-viewport fixed right-4 bottom-4 z-50 flex flex-col gap-2"
    >
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={dismissToast} />
      ))}
    </div>
  )
}
