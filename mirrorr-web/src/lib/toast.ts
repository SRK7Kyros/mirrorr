/**
 * Toast store — the single source for the Toast primitive
 * (`src/components/ui/Toast.tsx`), consolidated from the Wave-0 auth-flow
 * placeholder.
 *
 * Contract: `docs/web-frontend-spec.md` L110 (bottom-right, `bg-overlay` +
 * border, close button, auto-dismiss 5s, errors sticky) and L156/L371 — the
 * exact 429, session-expired and password-changed copy the auth layer raises.
 * The store owns the timing and sticky rule; the primitive owns role, layout
 * and the close control.
 */
export type ToastTone = "error" | "info"

export interface ToastMessage {
  readonly id: number
  readonly message: string
  readonly tone: ToastTone
}

const AUTO_DISMISS_MS = 5000

let toasts: readonly ToastMessage[] = []
let nextId = 1
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

/** Shows a toast. `error` toasts are sticky (spec L110) — dismiss them. */
export function showToast(message: string, tone: ToastTone = "error"): number {
  const id = nextId
  nextId += 1
  toasts = [...toasts, { id, message, tone }]
  emit()

  if (tone === "info") {
    setTimeout(() => dismissToast(id), AUTO_DISMISS_MS)
  }

  return id
}

export function dismissToast(id: number): void {
  const next = toasts.filter((toast) => toast.id !== id)
  if (next.length === toasts.length) return
  toasts = next
  emit()
}

export function getToasts(): readonly ToastMessage[] {
  return toasts
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Test-only reset; also used when a forced logout wipes the session. */
export function clearToasts(): void {
  toasts = []
  emit()
}
