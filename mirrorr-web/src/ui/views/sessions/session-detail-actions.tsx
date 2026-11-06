import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { deleteSession, getErrorMessage, removeFromInfiniteLists, stopSession } from "@/api"
import type { Session } from "@/api/schemas"
import { queryKeys, queryRoots } from "@/api/query-keys"
import { getStatusDescriptor } from "@/api/status"
import { cn } from "@/ui/lib/cn"
import {
  Button,
  ConfirmDialog,
  IconStop,
  RowActions,
  toast,
  type RowAction,
} from "@/ui/components"
import { SessionSaveProfileDialog } from "./session-save-profile-button"

/** `remuxing` answers DELETE with 409 — the item is disabled rather than silently failing. */
const REMUXING = "remuxing"

/**
 * The header's primary verb while a run is live. A dialog, not a bare call: the
 * plan's decision 5 makes stop a confirmed action ("ends the capture, keeps the
 * file"), and a mis-aimed click on the page's most prominent control costs a
 * recording.
 */
export function StopRecordingAction({
  session,
  label,
}: {
  readonly session: Session
  readonly label: string
}) {
  const queryClient = useQueryClient()
  const [confirm, setConfirm] = useState(false)

  const stop = useMutation({
    mutationFn: () => stopSession(session.id),
    onSuccess: () => {
      toast.success("Stopping the recording", label)
      void queryClient.invalidateQueries({ queryKey: queryRoots.sessions })
      void queryClient.invalidateQueries({ queryKey: queryKeys.session(session.id) })
    },
    onError: (error) =>
      toast.error("Could not stop the recording", getErrorMessage(error, "Request failed")),
  })

  return (
    <>
      <Button
        variant="danger"
        size="lg"
        className="min-h-11 min-w-11"
        icon={<IconStop size={15} />}
        loading={stop.isPending}
        onClick={() => setConfirm(true)}
      >
        Stop recording
      </Button>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Stop recording ${label}?`}
        description="Ends the capture and keeps the file already written."
        confirmLabel="Stop recording"
        onConfirm={() => stop.mutateAsync()}
      />
    </>
  )
}

/**
 * The one `⋯` on the detail page: save-as-profile and delete, destructive item
 * last below a divider. Delete's copy is built from the run's state — on a live
 * run the core sends `stop` before it deletes, so the dialog has to say so
 * instead of leaving the user to discover it.
 */
export function SessionOverflow({
  session,
  label,
  live,
}: {
  readonly session: Session
  readonly label: string
  readonly live: boolean
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [saveOpen, setSaveOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const actions = getStatusDescriptor(session.status).sessionActions

  const remove = useMutation({
    mutationFn: () => deleteSession(session.id),
    onSuccess: () => {
      removeFromInfiniteLists(queryClient, queryRoots.sessions, session.id)
      queryClient.removeQueries({ queryKey: queryKeys.session(session.id) })
      toast.success("Session deleted", `#${session.id}`)
      void queryClient.invalidateQueries({ queryKey: queryRoots.sessions })
      void navigate({ to: "/sessions" })
    },
    onError: (error) =>
      toast.error("Could not delete the session", getErrorMessage(error, "Request failed")),
  })

  const items: RowAction[] = []
  if (actions.includes("save-as-profile")) {
    items.push({ label: "Save as profile…", onSelect: () => setSaveOpen(true) })
  }
  items.push({
    label: "Delete…",
    danger: true,
    separatorBefore: items.length > 0,
    disabled: session.status === REMUXING,
    onSelect: () => setDeleteOpen(true),
  })

  return (
    <>
      <RowActions label={`More actions for ${label}`} actions={items} />
      <SessionSaveProfileDialog
        session={session}
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
      />
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={`Delete ${label}?`}
        description={
          session.status === REMUXING
            ? "This run is remuxing. Wait for it to finish before deleting it."
            : live
              ? "Stops the recording, then deletes the run. Recordings already published are kept."
              : "Deletes the run and its record. Recordings already published are kept."
        }
        confirmLabel="Delete"
        onConfirm={() => remove.mutateAsync()}
      />
    </>
  )
}

/** A quiet back link, shared by the page header block and its dead-end states. */
export function BackToSessionsLink({ className }: { readonly className?: string }) {
  return (
    <Link
      to="/sessions"
      className={cn(
        "tab-stop inline-flex min-h-8 w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-ink-muted hover:text-ink",
        className,
      )}
    >
      <span aria-hidden="true">←</span> Back to sessions
    </Link>
  )
}
