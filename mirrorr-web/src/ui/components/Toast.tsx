import { useSyncExternalStore, type ReactNode } from "react"
import { cn } from "@/ui/lib/cn"
import { IconAlert, IconCheck, IconInfo } from "./icons"

export type ToastKind = "success" | "error" | "info"

/** Optional inline affordance — the shell maps a realtime `EventToast` onto this. */
export interface ToastAction {
  readonly label: string
  readonly onClick: () => void
}

export interface ToastItem {
  readonly id: number
  readonly kind: ToastKind
  readonly title: string
  readonly text?: string
  readonly action?: ToastAction
}

/**
 * Minimal toast store — module-level, no context. Views call `toast.success`
 * / `toast.error` / `toast.info`; `ToastRegion` (mounted once by the app
 * shell) renders the queue.
 */
let nextId = 1
let items: readonly ToastItem[] = []
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function push(kind: ToastKind, title: string, text?: string, action?: ToastAction): number {
  const id = nextId++
  items = [
    ...items,
    {
      id,
      kind,
      title,
      ...(text === undefined ? {} : { text }),
      ...(action === undefined ? {} : { action }),
    },
  ]
  emit()
  window.setTimeout(() => dismiss(id), kind === "error" ? 8000 : 5000)
  return id
}

export function dismiss(id: number): void {
  const next = items.filter((item) => item.id !== id)
  if (next.length === items.length) return
  items = next
  emit()
}

export const toast = {
  success: (title: string, text?: string, action?: ToastAction) => push("success", title, text, action),
  error: (title: string, text?: string, action?: ToastAction) => push("error", title, text, action),
  info: (title: string, text?: string, action?: ToastAction) => push("info", title, text, action),
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): readonly ToastItem[] {
  return items
}

const ICONS: Record<ToastKind, ReactNode> = {
  success: <IconCheck size={16} />,
  error: <IconAlert size={16} />,
  info: <IconInfo size={16} />,
}

/** Fixed bottom-right toast stack — `.toast-region`. Mount once per app. */
export function ToastRegion({ className }: { readonly className?: string }) {
  const toasts = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  if (toasts.length === 0) return null
  return (
    <div className={cn("toast-region", className)} aria-live="polite" aria-atomic="false">
      {toasts.map((item) => (
        <div key={item.id} className="toast" data-kind={item.kind} role="status">
          <span className="toast-icon" aria-hidden="true">
            {ICONS[item.kind]}
          </span>
          <div className="toast-body">
            <div className="toast-title">{item.title}</div>
            {item.text !== undefined ? <div className="toast-text">{item.text}</div> : null}
            {item.action !== undefined ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={item.action.onClick}>
                {item.action.label}
              </button>
            ) : null}
          </div>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Dismiss" onClick={() => dismiss(item.id)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}
