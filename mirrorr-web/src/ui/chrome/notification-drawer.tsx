import { useState } from "react"
import { Link } from "@tanstack/react-router"
import {
  useDeleteNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
} from "@/api/hooks"
import type { Notification } from "@/api/schemas"
import { formatRelativeTime } from "@/api/time"
import { getErrorMessage } from "@/api/domain/errors"
import {
  Badge,
  Banner,
  Button,
  ConfirmDialog,
  Drawer,
  EmptyState,
  IconBell,
  IconButton,
  IconCheck,
  IconTrash,
  Panel,
  PanelBody,
  QueryState,
  Skeleton,
} from "@/ui/components"
import { describeNotification, type NotificationTarget } from "./notification-copy"

/**
 * The notification query, including its state.
 *
 * The drawer used to receive `data ?? []`, so a request that failed rendered
 * the "No notifications" empty state — the exact lie `CMP-08` calls the app's
 * biggest trust bug. It now reads the state it needs to tell loading from empty
 * from failed.
 */
export interface NotificationQuery {
  readonly data: readonly Notification[] | undefined
  readonly isLoading: boolean
  readonly isError: boolean
  readonly error: unknown
  readonly refetch: () => unknown
}

function rowsSkeleton() {
  return (
    <div className="flex flex-col gap-2" role="status" aria-label="Loading notifications">
      {[0, 1, 2].map((key) => (
        <div key={key} className="flex flex-col gap-2 rounded-md border border-line-subtle p-3">
          <Skeleton width="60%" height={14} />
          <Skeleton width="35%" height={11} />
        </div>
      ))}
    </div>
  )
}

function targetLink(target: NotificationTarget, onNavigate: () => void) {
  switch (target.kind) {
    case "session":
      return (
        <Link
          className="text-base text-brand underline-offset-2 hover:underline"
          to="/sessions/$sessionId"
          params={{ sessionId: String(target.id) }}
          onClick={onNavigate}
        >
          {target.label}
        </Link>
      )
    case "autorun":
      return (
        <Link
          className="text-base text-brand underline-offset-2 hover:underline"
          to="/autoruns/$autorunId"
          params={{ autorunId: String(target.id) }}
          onClick={onNavigate}
        >
          {target.label}
        </Link>
      )
    case "recording":
      return (
        <Link
          className="text-base text-brand underline-offset-2 hover:underline"
          to="/recordings"
          search={{ highlight: target.id }}
          onClick={onNavigate}
        >
          {target.label}
        </Link>
      )
  }
}

/**
 * The bell's drawer (`CMP-18`): one formatter, a link to the object the event is
 * about, honest loading/error/empty states, and a confirm before a row is
 * deleted. Mark-all is disabled on an empty or unread-free list instead of
 * firing a request that changes nothing.
 */
export function NotificationDrawer({
  open,
  onClose,
  onNavigate,
  query,
}: {
  readonly open: boolean
  /** Closes the panel; a dismissal (Esc, scrim, close button) lands here. */
  readonly onClose: () => void
  /** Closes the panel because the operator is leaving for the linked object. */
  readonly onNavigate?: () => void
  readonly query: NotificationQuery
}) {
  const markRead = useMarkNotificationRead()
  const markAll = useMarkAllNotificationsRead()
  const remove = useDeleteNotification()
  const [deleting, setDeleting] = useState<Notification | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const items = query.data ?? []
  const unread = items.filter((item) => item.read !== true).length
  const busy = markAll.isPending || remove.isPending

  const failed = (caught: unknown, fallback: string) => setFailure(getErrorMessage(caught, fallback))

  const deletingCopy = deleting === null ? null : describeNotification(deleting)

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title="Notifications"
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="text-dim">
              {query.isError
                ? "Could not load notifications"
                : unread > 0
                  ? `${unread} unread`
                  : "All caught up"}
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={unread === 0 || busy || query.isError}
              onClick={() => {
                setFailure(null)
                markAll.mutate(undefined, {
                  onError: (caught) => failed(caught, "Could not mark everything read"),
                })
              }}
            >
              Mark all read
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          {failure !== null ? (
            <Banner
              kind="danger"
              title={failure}
              action={
                <Button size="sm" variant="outline" onClick={() => setFailure(null)}>
                  Dismiss
                </Button>
              }
            />
          ) : null}

          <QueryState
            query={query}
            loading={rowsSkeleton()}
            errorMessage="Could not load notifications"
            isEmpty={items.length === 0}
            empty={
              <EmptyState
                icon={<IconBell size={22} />}
                title="No notifications"
                text="Session and autorun events land here."
              />
            }
          >
            <ul aria-label="Notification list" className="flex flex-col gap-2">
              {items.map((item) => {
                const copy = describeNotification(item)
                return (
                  <li key={item.id}>
                    <Panel>
                      <PanelBody className="flex flex-col gap-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 flex-col gap-1">
                            <strong className="text-base text-ink [overflow-wrap:anywhere]">
                              {copy.headline}
                            </strong>
                            {item.body !== undefined && item.body !== "" ? (
                              <span className="text-base text-ink-muted [overflow-wrap:anywhere]">
                                {item.body}
                              </span>
                            ) : null}
                          </div>
                          {item.read !== true ? <Badge variant="accent">New</Badge> : null}
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="text-sm text-ink-dim">
                              {formatRelativeTime(item.created_at)}
                            </span>
                            {copy.target === null ? null : targetLink(copy.target, onNavigate ?? onClose)}
                          </div>
                          <div className="flex items-center gap-1">
                            {item.read !== true ? (
                              <IconButton
                                label={`Mark “${copy.headline}” read`}
                                size="sm"
                                className="[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
                                icon={<IconCheck size={15} />}
                                disabled={busy}
                                onClick={() => {
                                  setFailure(null)
                                  markRead.mutate(item.id, {
                                    onError: (caught) =>
                                      failed(caught, "Could not mark the notification read"),
                                  })
                                }}
                              />
                            ) : null}
                            <IconButton
                              label={`Delete “${copy.headline}”`}
                              size="sm"
                              variant="ghost"
                              className="[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
                              icon={<IconTrash size={15} />}
                              disabled={busy}
                              onClick={() => setDeleting(item)}
                            />
                          </div>
                        </div>
                      </PanelBody>
                    </Panel>
                  </li>
                )
              })}
            </ul>
          </QueryState>
        </div>
      </Drawer>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={
          deleting === null
            ? "Delete this notification?"
            : `Delete “${deletingCopy?.headline ?? `Notification #${deleting.id}`}”?`
        }
        description="This removes the notification only — the session, autorun or recording it names is not touched."
        confirmLabel="Delete notification"
        danger
        onConfirm={async () => {
          if (deleting === null) return
          setFailure(null)
          try {
            await remove.mutateAsync(deleting.id)
            setDeleting(null)
          } catch (caught) {
            setDeleting(null)
            failed(caught, "Could not delete the notification")
          }
        }}
      />
    </>
  )
}
