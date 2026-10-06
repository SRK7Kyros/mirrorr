import { useDeleteNotification, useMarkAllNotificationsRead, useMarkNotificationRead } from "@/api/hooks"
import type { Notification } from "@/api/schemas"
import { formatRelativeTime } from "@/api/time"
import {
  Badge,
  Button,
  Drawer,
  EmptyState,
  IconBell,
  IconButton,
  IconCheck,
  IconTrash,
  Panel,
  PanelBody,
} from "@/ui/components"

export function NotificationDrawer({
  open,
  onClose,
  items,
}: {
  readonly open: boolean
  readonly onClose: () => void
  readonly items: readonly Notification[]
}) {
  const markRead = useMarkNotificationRead()
  const markAll = useMarkAllNotificationsRead()
  const remove = useDeleteNotification()
  const unread = items.filter((item) => item.read !== true).length

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Notifications"
      footer={
        <div className="row-between">
          <span className="text-dim">{unread > 0 ? `${unread} unread` : "All caught up"}</span>
          <Button
            size="sm"
            variant="secondary"
            disabled={unread === 0 || markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            Mark all read
          </Button>
        </div>
      }
    >
      {items.length === 0 ? (
        <EmptyState
          icon={<IconBell size={22} />}
          title="No notifications"
          text="Session and autorun events land here."
        />
      ) : (
        <div className="stack-sm">
          {items.map((item) => (
            <Panel key={item.id}>
              <PanelBody className="stack stack-sm">
                <div className="row-between">
                  <strong>{item.title}</strong>
                  {item.read !== true ? <Badge variant="accent">New</Badge> : null}
                </div>
                {item.body !== undefined && item.body !== "" ? <div className="text-muted">{item.body}</div> : null}
                <div className="row-between">
                  <span className="text-dim">{formatRelativeTime(item.created_at)}</span>
                  <span className="row">
                    {item.read !== true ? (
                      <IconButton
                        label="Mark read"
                        size="sm"
                        icon={<IconCheck size={15} />}
                        onClick={() => markRead.mutate(item.id)}
                      />
                    ) : null}
                    <IconButton
                      label="Delete notification"
                      size="sm"
                      variant="ghost"
                      icon={<IconTrash size={15} />}
                      onClick={() => remove.mutate(item.id)}
                    />
                  </span>
                </div>
              </PanelBody>
            </Panel>
          ))}
        </div>
      )}
    </Drawer>
  )
}
