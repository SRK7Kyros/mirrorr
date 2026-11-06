import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { getErrorMessage, stopSession } from "@/api"
import type { Session } from "@/api/schemas"
import { getStatusDescriptor } from "@/api/status"
import { Button, ConfirmDialog, ErrorPanel, IconStop, toast, type ButtonSize } from "@/ui/components"

/** 44 px on a coarse pointer, the sizes above elsewhere (`plan.md` §2.5). */
const COARSE_TARGET = "[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"

/** The run's own title, quoted, when it has one. */
function runName(session: Session): string | null {
  const named = session.autorun_name ?? session.profile_name ?? ""
  return named === "" ? null : `“${named}”`
}

/**
 * The live run's one terminal verb (`FLW-02`).
 *
 * A card used to show `Stop` and `Delete` as two glyphs whose difference was
 * invisible; delete now lives in the `⋯` overflow (`session-delete-action.tsx`)
 * and this button is the only terminal control a live card carries. It says
 * what it does, states plainly that the file is kept, and confirms — naming the
 * run — before the endpoint is called. Spent statuses get no button: their only
 * terminal action is delete, which belongs in the overflow.
 */
export function SessionStopDeleteButton({
  session,
  size = "sm",
}: {
  readonly session: Session
  readonly size?: ButtonSize
}) {
  const [confirming, setConfirming] = useState(false)
  const allowed = getStatusDescriptor(session.status).sessionActions.includes("stop")
  const name = runName(session)

  const stop = useMutation({
    mutationFn: () => stopSession(session.id),
    onSuccess: () => toast.success("Stopping session", `#${session.id}`),
  })

  if (!allowed) return null

  const failure = stop.isError ? getErrorMessage(stop.error, "Could not stop the session") : null

  return (
    <>
      <Button
        variant="secondary"
        size={size}
        className={COARSE_TARGET}
        icon={<IconStop size={15} />}
        aria-label={`Stop recording session #${session.id}`}
        loading={stop.isPending}
        onClick={() => setConfirming(true)}
      >
        Stop recording
      </Button>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Stop recording session #${session.id}?`}
        description={
          name === null
            ? "The capture ends now and the file written so far is kept."
            : `${name} ends its capture now. The file written so far is kept.`
        }
        confirmLabel="Stop recording"
        onConfirm={async () => {
          await stop.mutateAsync()
        }}
      >
        {failure === null ? null : <ErrorPanel message={failure} />}
      </ConfirmDialog>
    </>
  )
}
