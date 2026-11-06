import { useState, type ReactNode } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { deleteSession, getErrorMessage, removeFromInfiniteLists } from "@/api"
import { isLive } from "@/api/domain/filter-grammar"
import type { Session } from "@/api/schemas"
import { queryKeys, queryRoots } from "@/api/query-keys"
import { getStatusDescriptor } from "@/api/status"
import { ConfirmDialog, ErrorPanel, toast, type RowAction } from "@/ui/components"

/**
 * Delete as a `⋯` item, for the statuses that no longer render the terminal
 * button (`session-stop-delete-button.tsx` keeps the live `Stop`). The dialog is
 * returned beside the item so the card renders both and the mutation lives in
 * one place instead of being copied into the card.
 *
 * The record decides: a status whose action set has no `delete` gets neither.
 * The confirm names the run and spells out that a run still finishing is
 * stopped before the record goes (`FLW-02`).
 */
export function useSessionDeleteAction(session: Session): {
  readonly action: RowAction | null
  readonly dialog: ReactNode
} {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const allowed = getStatusDescriptor(session.status).sessionActions.includes("delete")

  const remove = useMutation({
    mutationFn: () => deleteSession(session.id),
    onSuccess: () => {
      removeFromInfiniteLists(queryClient, queryRoots.sessions, session.id)
      queryClient.removeQueries({ queryKey: queryKeys.session(session.id) })
      toast.success("Session deleted", `#${session.id}`)
      void queryClient.invalidateQueries({ queryKey: queryRoots.sessions })
    },
  })

  if (!allowed) return { action: null, dialog: null }

  const named = session.autorun_name ?? session.profile_name ?? ""
  const name = named === "" ? null : `“${named}”`
  const live = isLive(session.status)
  const failure = remove.isError
    ? getErrorMessage(remove.error, "Could not delete the session")
    : null

  return {
    action: {
      label: `Delete session #${session.id}`,
      danger: true,
      separatorBefore: true,
      onSelect: () => setOpen(true),
    },
    dialog: (
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Delete session #${session.id}?`}
        description={
          live
            ? `${name === null ? "This run is" : `${name} is`} still finishing — deleting it stops the recording first, then removes the session record. The file already written is kept.`
            : name === null
              ? "This removes the session record. Recordings already written to disk are kept."
              : `This removes ${name}'s session record. Recordings already written to disk are kept.`
        }
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          await remove.mutateAsync()
        }}
      >
        {failure === null ? null : <ErrorPanel message={failure} />}
      </ConfirmDialog>
    ),
  }
}
