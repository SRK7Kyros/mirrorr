import { AnimatePresence, motion } from "motion/react"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import { IconX } from "./icons"

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
const MAX_VISIBLE = 2

/**
 * Toast — §4: 320px, r8, pad12, shadow-toast (overlay only), enter
 * tween-enter / exit 0.15s. Success auto-dismisses at 4000ms with
 * role="status"; error is sticky until dismissed, role="alert", with a
 * close X. Stack capped at MAX_VISIBLE (§1 toast max 2); queue overflow
 * drops the oldest non-error — errors are sticky, never auto-dropped.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
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
      <div className="toast-viewport" role="region" aria-label="Notifications">
        <AnimatePresence>
          {items.map((item) => (
            <motion.div
              key={item.id}
              className={item.kind === "error" ? "toast toast--error" : "toast"}
              role={item.kind === "error" ? "alert" : "status"}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.15, ease: "easeIn" } }}
              transition={{ duration: 0.2, ease: "easeOut" }}
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

/** §7: toasts announce via role status/alert — caller reads context only. */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (context === null) {
    throw new Error("useToast must be used within ToastProvider")
  }
  return context
}
