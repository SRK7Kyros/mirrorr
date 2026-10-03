import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import { IconX } from "./icons"
import { tweenEnter, ui } from "./motion-tokens"

export interface ToastInput {
  readonly kind: "success" | "error"
  readonly title: string
  readonly body?: string
  readonly action?: { readonly label: string; readonly onClick: () => void }
}

interface ToastItem extends ToastInput {
  readonly id: number
}

interface ToastContextValue {
  readonly toast: (input: ToastInput) => void
  readonly dismiss: (id: number) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const SUCCESS_TTL_MS = 4000
/** §6.4: max 3 stacked; overflow drops the oldest non-error (errors are sticky). */
const MAX_VISIBLE = 3

/**
 * Toast — §6.4: acrylic 0.72/40 (the topmost surface gets the widest blur),
 * radius 4, pad 12×16, icon + 16px copy + optional action. Enters on `ui`,
 * exits on `tween-enter` (opacity-first). Error variant carries a danger-deep
 * left bar and never auto-dismisses. role=status for success (polite),
 * role=alert for errors (assertive) — both are #141414 copy (hard law 7).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion()
  const [items, setItems] = useState<ReadonlyArray<ToastItem>>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
    setItems((current) => current.filter((item) => item.id !== id))
  }, [])

  const toast = useCallback((input: ToastInput) => {
    const id = nextId.current
    nextId.current += 1
    const item: ToastItem = { ...input, id }

    setItems((current) => {
      const next = [...current, item]
      while (next.length > MAX_VISIBLE) {
        const oldestNonError = next.findIndex((entry) => entry.kind !== "error")
        if (oldestNonError === -1) break
        next.splice(oldestNonError, 1)
      }
      return next
    })

    if (input.kind === "success") {
      timers.current.set(
        id,
        setTimeout(() => {
          timers.current.delete(id)
          setItems((current) => current.filter((existing) => existing.id !== id))
        }, SUCCESS_TTL_MS),
      )
    }
  }, [])

  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
    }
  }, [])

  const value = useMemo<ToastContextValue>(() => ({ toast, dismiss }), [toast, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* §8.5: the toast region is a live region, not a navigation landmark —
         each toast carries role=status/alert. Naming it a "region" collides
         with the notification drawer's own "Notifications" landmark
         (axe landmark-unique §8.1). */}
      <div className="toast-viewport">
        <AnimatePresence>
          {items.map((item) => (
            <motion.div
              key={item.id}
              className={
                item.kind === "error"
                  ? "toast toast--error acrylic acrylic--toast acrylic--r-sm"
                  : "toast acrylic acrylic--toast acrylic--r-sm"
              }
              role={item.kind === "error" ? "alert" : "status"}
              initial={{ opacity: 0, y: reduced === true ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={item.kind === "error" ? tweenEnter : ui}
            >
              <span className="toast__dot" aria-hidden="true" />
              <div className="toast__content">
                <p className="toast__title">{item.title}</p>
                {item.body !== undefined ? <p className="toast__body">{item.body}</p> : null}
                {item.action !== undefined ? (
                  <button type="button" className="toast__action" onClick={item.action.onClick}>
                    {item.action.label}
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                className="toast__close"
                aria-label="Dismiss notification"
                onClick={() => dismiss(item.id)}
              >
                <IconX size={14} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

/** §8.5: toasts announce via role=status/alert — the caller reads context only. */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (context === null) {
    throw new Error("useToast must be used within ToastProvider")
  }
  return context
}
