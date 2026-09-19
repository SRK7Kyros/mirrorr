import { AlertTriangle, Info, X } from "lucide-react"
import { useSyncExternalStore } from "react"
import { dismissToast, getToasts, subscribeToasts, type ToastMessage } from "@/lib/toast"

const NO_TOASTS: readonly ToastMessage[] = []

export function ToastViewport() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, () => NO_TOASTS)

  if (toasts.length === 0) return null

  return (
    <div
      data-testid="toast-viewport"
      aria-live="polite"
      className="fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          data-testid="toast"
          role="status"
          className="flex items-start gap-2 rounded-surface border border-border bg-bg-overlay px-3 py-2 text-small text-text-primary shadow-[0_4px_12px_rgba(0,0,0,0.4)]"
        >
          {toast.tone === "error" ? (
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-danger" />
          ) : (
            <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-accent" />
          )}
          <span className="flex-1">{toast.message}</span>
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => dismissToast(toast.id)}
            className="text-text-muted transition-colors hover:text-text-primary"
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
