import { AnimatePresence, motion } from "motion/react"
import { useEffect, useRef } from "react"
import { Button } from "@/components/ui/Button"
import { useFocusTrap } from "@/components/ui/focus-trap"
import { EmptyState } from "@/components/ui/EmptyState"
import { IconBell, IconX } from "@/components/ui/icons"

export interface NotificationItem {
  readonly id: string
  readonly title: string
  readonly timeLabel: string
  readonly unread: boolean
}

export interface NotificationDrawerProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly items: ReadonlyArray<NotificationItem>
  readonly onMarkAllRead: () => void
  readonly onOpenItem?: (item: NotificationItem) => void
  readonly onDeleteItem?: (item: NotificationItem) => void
}

const enterTransition = { duration: 0.2, ease: "easeOut" } as const
const exitTransition = { duration: 0.15, ease: "easeIn" } as const

/**
 * NotificationDrawer + bell target (§4): 360px right drawer on bg-panel,
 * header 48 with “Notifications” + ghost “Mark all read”, rows 56
 * (48 compact) with icon/title/time + 24px delete, unread = fill-active
 * row + `#7DB1E5` icon + aria-label carrying “unread”; empty state is the
 * EmptyState primitive. ui token enter, Esc + backdrop close, focus trap.
 */
export function NotificationDrawer({
  open,
  onClose,
  items,
  onMarkAllRead,
  onOpenItem,
  onDeleteItem,
}: NotificationDrawerProps) {
  const panelRef = useRef<HTMLElement>(null)
  useFocusTrap(panelRef, open, onClose)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [open, onClose])

  if (typeof document === "undefined") return null

  const unreadCount = items.filter((item) => item.unread).length

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="notif-layer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: exitTransition }}
          transition={enterTransition}
          style={{ position: "fixed", inset: 0, zIndex: 44 }}
        >
          <div className="overlay-backdrop" onClick={onClose} />
          <motion.aside
            ref={panelRef}
            className="notif-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Notifications"
            initial={{ x: 24, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 24, opacity: 0, transition: exitTransition }}
            transition={enterTransition}
          >
            <div className="notif-drawer__header">
              <span className="notif-drawer__title">Notifications</span>
              <div className="topbar__cluster">
                <Button variant="ghost" onClick={onMarkAllRead} disabled={unreadCount === 0}>
                  Mark all read
                </Button>
                <button
                  type="button"
                  className="overflow__trigger"
                  aria-label="Close notifications"
                  onClick={onClose}
                >
                  <IconX size={14} />
                </button>
              </div>
            </div>
            <div className="notif-drawer__body">
              {items.length === 0 ? (
                <EmptyState headline="No notifications" body="You're all caught up." />
              ) : (
                items.map((item) => (
                  <div
                    key={item.id}
                    className="notif-row"
                    data-unread={item.unread || undefined}
                    role="button"
                    tabIndex={0}
                    aria-label={item.unread ? `${item.title} (unread)` : item.title}
                    onClick={() => onOpenItem?.(item)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        onOpenItem?.(item)
                      }
                    }}
                  >
                    <span className="notif-row__icon" aria-hidden="true">
                      <IconBell size={16} />
                    </span>
                    <span className="notif-row__content">
                      <span className="notif-row__title">{item.title}</span>
                      <span className="notif-row__time">{item.timeLabel}</span>
                    </span>
                    <button
                      type="button"
                      className="notif-row__delete"
                      aria-label={`Delete notification: ${item.title}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        onDeleteItem?.(item)
                      }}
                    >
                      <IconX size={12} />
                    </button>
                  </div>
                ))
              )}
            </div>
            {items.length > 0 ? (
              <div className="notif-drawer__footer">
                <Button variant="ghost" onClick={onMarkAllRead} disabled={unreadCount === 0}>
                  Mark all read
                </Button>
              </div>
            ) : null}
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
