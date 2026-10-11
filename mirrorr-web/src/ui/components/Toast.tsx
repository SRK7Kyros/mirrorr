import { useSyncExternalStore, type ReactNode } from "react"
import { AnimatePresence, motion } from "motion/react"
import { cn } from "@/ui/lib/cn"
import { toastVariants } from "@/ui/lib/motion"
import { buttonClass, iconButtonClass } from "./Button"
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

let nextId = 1
let items: readonly ToastItem[] = []
const listeners = new Set<() => void>()
const timers = new Map<number, ReturnType<typeof setTimeout>>()

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
  timers.set(id, window.setTimeout(() => dismiss(id), kind === "error" ? 8000 : 5000))
  return id
}

export function dismiss(id: number): void {
  const timer = timers.get(id)
  if (timer !== undefined) {
    clearTimeout(timer)
    timers.delete(id)
  }
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

const ICON_TONE: Record<ToastKind, string> = {
  success: "text-success",
  error: "text-danger",
  info: "text-info",
}

const EDGE_TONE: Record<ToastKind, string> = {
  success: "border-l-success",
  error: "border-l-danger",
  info: "border-l-info",
}

const REGION_CLASS = [
  "fixed bottom-5 right-5 z-[var(--z-toast)] flex flex-col gap-2",
  "w-[min(24rem,calc(100vw_-_32px))] pointer-events-none",
  "max-sm:left-3 max-sm:right-3 max-sm:w-auto",
  "max-sm:bottom-[calc(var(--bottomnav-h)_+_env(safe-area-inset-bottom,0px)_+_var(--s-6))]",
].join(" ")

/** Fixed bottom-right toast stack. Mount once per app. */
export function ToastRegion({ className }: { readonly className?: string }) {
  const toasts = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return (
    <div className={cn(REGION_CLASS, className)} aria-live="polite" aria-atomic="false">
      <AnimatePresence initial={false}>
        {toasts.map((item) => (
          <motion.div
            key={item.id}
            layout
            className={cn(
              "flex items-start gap-3 py-3 px-4 bg-surface-3 border border-line-strong border-l-[3px] rounded-md shadow-elev-md pointer-events-auto",
              EDGE_TONE[item.kind],
            )}
            data-kind={item.kind}
            role="status"
            variants={toastVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <span className={cn("mt-px shrink-0", ICON_TONE[item.kind])} aria-hidden="true">
              {ICONS[item.kind]}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-base font-semibold">{item.title}</div>
              {item.text !== undefined ? <div className="text-sm text-ink-muted mt-0.5 break-words">{item.text}</div> : null}
              {item.action !== undefined ? (
                <button
                  type="button"
                  className={buttonClass({ variant: "ghost", size: "sm" })}
                  onClick={item.action.onClick}
                >
                  {item.action.label}
                </button>
              ) : null}
            </div>
            <button
              type="button"
              className={iconButtonClass({ variant: "ghost", size: "sm" })}
              aria-label="Dismiss"
              onClick={() => dismiss(item.id)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}