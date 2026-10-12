import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { deleteSession, getErrorMessage, removeFromInfiniteLists, stopSession } from "@/api"
import type { Session } from "@/api/schemas"
import { queryKeys, queryRoots } from "@/api/query-keys"
import { getStatusDescriptor } from "@/api/status"
import { Button, ConfirmDialog, IconStop, IconTrash, toast, type ButtonSize } from "@/ui/components"

/**
 * A ghost icon that fills red on every pointer interaction. Expressed at the
 * call site because the `ghost` variant already emits its own hover
 * background/text: the `data-slot=button` + `:not(:disabled)` in each variant
 * buys the specificity that makes the fill win deterministically rather than
 * depending on Tailwind's emitted order.
 */
const DANGER_ICON = [
  "[&[data-slot=button]:hover:not(:disabled)]:bg-danger",
  "[&[data-slot=button]:hover:not(:disabled)]:border-danger",
  "[&[data-slot=button]:hover:not(:disabled)]:text-danger-ink",
  "[&[data-slot=button]:focus-visible:not(:disabled)]:bg-danger",
  "[&[data-slot=button]:focus-visible:not(:disabled)]:border-danger",
  "[&[data-slot=button]:focus-visible:not(:disabled)]:text-danger-ink",
  "[&[data-slot=button]:active:not(:disabled)]:bg-danger",
  "[&[data-slot=button]:active:not(:disabled)]:border-danger",
  "[&[data-slot=button]:active:not(:disabled)]:text-danger-ink",
].join(" ")

/**
 * One icon for the session's terminal action: stop while it is live, delete
 * once it is spent. `STATUS_MAP.sessionActions` decides which — a status that
 * allows neither renders nothing.
 */
export function SessionStopDeleteButton({
  session,
  size = "sm",
}: {
  readonly session: Session
  readonly size?: ButtonSize
}) {
  const queryClient = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const actions = getStatusDescriptor(session.status).sessionActions

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryRoots.sessions })
    void queryClient.invalidateQueries({ queryKey: queryKeys.session(session.id) })
  }

  const stop = useMutation({
    mutationFn: () => stopSession(session.id),
    onSuccess: () => {
      toast.success("Stopping session", `#${session.id}`)
      invalidate()
    },
    onError: (error) => toast.error("Could not stop the session", getErrorMessage(error, "Request failed")),
  })

  const remove = useMutation({
    mutationFn: () => deleteSession(session.id),
    onSuccess: () => {
      removeFromInfiniteLists(queryClient, queryRoots.sessions, session.id)
      queryClient.removeQueries({ queryKey: queryKeys.session(session.id) })
      toast.success("Session deleted", `#${session.id}`)
      invalidate()
    },
    onError: (error) => toast.error("Could not delete the session", getErrorMessage(error, "Request failed")),
  })

  if (actions.includes("stop")) {
    return (
      <Button
        variant="ghost"
        size={size}
        className={DANGER_ICON}
        icon={<IconStop size={16} />}
        aria-label={`Stop session #${session.id}`}
        title="Stop"
        loading={stop.isPending}
        onClick={() => stop.mutate()}
      />
    )
  }

  if (!actions.includes("delete")) return null

  return (
    <>
      <Button
        variant="ghost"
        size={size}
        className={DANGER_ICON}
        icon={<IconTrash size={16} />}
        aria-label={`Delete session #${session.id}`}
        title="Delete"
        onClick={() => setConfirmDelete(true)}
      />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete session #${session.id}?`}
        description="This removes the session record. Recordings already written to disk are kept."
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          try {
            await remove.mutateAsync()
          } catch {
            // onError surfaced a toast; keep the dialog open for a retry.
          }
        }}
      />
    </>
  )
}
