/**
 * Spec L406 and the contract §11.3 / §13.10.2 row rules: the drawer is fed by
 * REST rows only, unread first, with mark-read / mark-all-read / per-row delete
 * and the footer "Clear" that loops one delete per loaded row behind a single
 * confirmation. A row click navigates by `resource_type` and marks the row
 * read. Synthetic WS frames never enter this list.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Bell, CheckCheck, Eraser, Trash2, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/Button"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { EmptyState } from "@/components/ui/EmptyState"
import { ErrorPanel } from "@/components/ui/ErrorPanel"
import { FOCUS_RING } from "@/components/ui/focus-ring"
import { SkeletonRows } from "@/components/ui/SkeletonRows"
import { userMessageForError } from "@/lib/errors"
import { formatRelativeTime } from "@/lib/format"
import {
  clearNotifications,
  deleteNotification,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationRow,
} from "@/lib/notifications-api"
import { acknowledgeAllSyntheticNotifications } from "@/lib/notification-policy"
import { queryKeys } from "@/lib/query-keys"
import { showToast } from "@/lib/toast"

export type NotificationDestination =
  | { readonly kind: "session"; readonly id: number }
  | { readonly kind: "autorun"; readonly id: number }
  | { readonly kind: "recording"; readonly id: number }
  | { readonly kind: "profile"; readonly id: number }

/** The click-to-navigate map (spec L387, L406): list-highlight destinations for recordings/profiles. */
export function notificationDestination(
  row: Pick<NotificationRow, "resource_type" | "resource_id">,
): NotificationDestination | null {
  switch (row.resource_type) {
    case "session":
      return { kind: "session", id: row.resource_id }
    case "autorun":
      return { kind: "autorun", id: row.resource_id }
    case "recording":
      return { kind: "recording", id: row.resource_id }
    case "profile":
      return { kind: "profile", id: row.resource_id }
    default:
      return null
  }
}

export interface NotificationDrawerProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly rows: readonly NotificationRow[]
  readonly isLoading?: boolean
  readonly isError?: boolean
  readonly onRetry?: () => void
}

export function NotificationDrawer({
  open,
  onClose,
  rows,
  isLoading = false,
  isError = false,
  onRetry,
}: NotificationDrawerProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const panelRef = useRef<HTMLElement>(null)
  const [clearOpen, setClearOpen] = useState(false)
  const [clearPending, setClearPending] = useState(false)

  useEffect(() => {
    if (open) panelRef.current?.focus()
  }, [open])

  const patchRow = useCallback(
    (id: number, read: boolean) => {
      queryClient.setQueryData<NotificationRow[]>(queryKeys.notifications(), (current) =>
        current?.map((row) => (row.id === id ? { ...row, read } : row)),
      )
    },
    [queryClient],
  )

  const markRead = useMutation({
    mutationFn: markNotificationRead,
    onMutate: async (id: number) => {
      const previous = queryClient.getQueryData<NotificationRow[]>(queryKeys.notifications())
      patchRow(id, true)
      return { previous }
    },
    onError: (error, _id, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(queryKeys.notifications(), context.previous)
      }
      showToast(userMessageForError(error), "error")
    },
    onSuccess: (updated) => {
      patchRow(updated.id, updated.read)
    },
  })

  const markAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onMutate: async () => {
      const previous = queryClient.getQueryData<NotificationRow[]>(queryKeys.notifications())
      queryClient.setQueryData<NotificationRow[]>(queryKeys.notifications(), (current) =>
        current?.map((row) => ({ ...row, read: true })),
      )
      return { previous }
    },
    onError: (error, _variables, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(queryKeys.notifications(), context.previous)
      }
      showToast(userMessageForError(error), "error")
    },
    onSuccess: () => {
      acknowledgeAllSyntheticNotifications()
    },
  })

  const remove = useMutation({
    mutationFn: deleteNotification,
    onSuccess: (_result, id) => {
      queryClient.setQueryData<NotificationRow[]>(queryKeys.notifications(), (current) =>
        current?.filter((row) => row.id !== id),
      )
    },
    onError: (error) => {
      showToast(userMessageForError(error), "error")
    },
  })

  const ordered = useMemo(
    () =>
      [...rows].sort((left, right) => {
        if (left.read !== right.read) return left.read ? 1 : -1
        return right.created_at.localeCompare(left.created_at)
      }),
    [rows],
  )

  function navigateTo(destination: NotificationDestination): void {
    switch (destination.kind) {
      case "session":
        void navigate({ to: "/sessions/$sessionId", params: { sessionId: String(destination.id) } })
        break
      case "autorun":
        void navigate({ to: "/autoruns/$autorunId", params: { autorunId: String(destination.id) } })
        break
      case "recording":
        void navigate({ to: "/recordings", search: { highlight: destination.id } })
        break
      case "profile":
        void navigate({ to: "/profiles", search: { highlight: destination.id } })
        break
    }
  }

  function handleRowClick(row: NotificationRow): void {
    if (!row.read) markRead.mutate(row.id)
    const destination = notificationDestination(row)
    if (destination === null) return
    navigateTo(destination)
    onClose()
  }

  async function handleClearConfirm(): Promise<void> {
    setClearPending(true)
    const result = await clearNotifications(rows)
    setClearPending(false)
    setClearOpen(false)
    if (result.failed > 0) {
      showToast(
        `${result.failed} notification${result.failed === 1 ? "" : "s"} could not be deleted`,
        "error",
      )
    }
    // `refetchType: "all"`: the drawer itself holds props, not an observer, so
    // the refresh must not depend on the bell being mounted.
    await queryClient.invalidateQueries({ queryKey: queryKeys.notifications(), refetchType: "all" })
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close notifications"
        onClick={onClose}
        className="absolute inset-0 bg-bg-base/70"
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Notifications"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose()
        }}
        className="absolute inset-y-0 right-0 flex w-full max-w-95 flex-col border-l border-border bg-bg-overlay shadow-overlay"
      >
        <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
          <h2 className="text-title font-semibold text-text-primary">Notifications</h2>
          <div className="flex items-center gap-1">
            {rows.some((row) => !row.read) ? (
              <Button
                variant="ghost"
                size="sm"
                icon={CheckCheck}
                disabled={markAll.isPending}
                onClick={() => markAll.mutate()}
              >
                Mark all read
              </Button>
            ) : null}
            <Button variant="ghost" aria-label="Close notifications" icon={X} onClick={onClose} />
          </div>
        </header>
        {isLoading ? (
          <div className="p-3">
            <SkeletonRows count={4} />
          </div>
        ) : isError ? (
          <div className="p-3">
            <ErrorPanel message="Could not load notifications" onRetry={onRetry} />
          </div>
        ) : ordered.length === 0 ? (
          <EmptyState title="No notifications" description="You're all caught up." icon={Bell} />
        ) : (
          <ul className="flex-1 overflow-y-auto">
            {ordered.map((row) => {
              const time = formatRelativeTime(row.created_at, new Date())
              return (
                <li
                  key={row.id}
                  data-testid={`notification-row-${row.id}`}
                  className="flex items-start gap-2 border-b border-border px-3 py-3"
                >
                  {row.read ? (
                    <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0" />
                  ) : (
                    <span
                      data-testid={`notification-unread-${row.id}`}
                      aria-hidden="true"
                      className="mt-1.5 size-1.5 shrink-0 rounded-pill bg-accent"
                    />
                  )}
                  <button
                    type="button"
                    data-testid={`notification-open-${row.id}`}
                    onClick={() => handleRowClick(row)}
                    className={["flex min-w-0 flex-1 flex-col gap-0.5 rounded-control text-left", FOCUS_RING].join(" ")}
                  >
                    <span className="text-body text-text-primary">{row.title}</span>
                    <span className="text-micro text-text-muted">{time.text}</span>
                  </button>
                  <button
                    type="button"
                    aria-label="Delete notification"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(row.id)}
                    className={[
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-control text-text-muted",
                      "hover:bg-bg-raised hover:text-danger disabled:pointer-events-none disabled:opacity-40",
                      FOCUS_RING,
                    ].join(" ")}
                  >
                    <Trash2 aria-hidden="true" strokeWidth={2} className="size-[var(--icon-row)]" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <footer className="shrink-0 border-t border-border p-3">
          {rows.length > 0 ? (
            <Button variant="secondary" size="sm" icon={Eraser} className="w-full" onClick={() => setClearOpen(true)}>
              Clear
            </Button>
          ) : null}
        </footer>
        <ConfirmDialog
          open={clearOpen}
          title="Clear all notifications?"
          body="Permanently deletes every loaded notification."
          confirmLabel="Clear all"
          pending={clearPending}
          onConfirm={() => void handleClearConfirm()}
          onCancel={() => setClearOpen(false)}
        />
      </aside>
    </div>
  )
}
