import { useMutation, useQueryClient } from "@tanstack/react-query"
import { getErrorMessage, setSessionRecording, useEngines } from "@/api"
import type { Session } from "@/api/schemas"
import { queryKeys, queryRoots } from "@/api/query-keys"
import { getStatusDescriptor } from "@/api/status"
import { Button, IconDisc, toast, type ButtonSize } from "@/ui/components"

/**
 * The pressed state fills the toggle red. Each override carries `data-slot=button`
 * (always present on `Button`) plus `:not(:disabled)`, buying the extra
 * specificity that makes the fill beat the ghost variant's own rest and hover
 * colours deterministically instead of leaving it to Tailwind's emitted order.
 */
const RECORD_TOGGLE = [
  "[&[data-slot=button][aria-pressed=true]]:bg-danger",
  "[&[data-slot=button][aria-pressed=true]]:border-danger",
  "[&[data-slot=button][aria-pressed=true]]:text-danger-ink",
  "[&[data-slot=button][aria-pressed=true]:hover:not(:disabled)]:bg-danger",
  "[&[data-slot=button][aria-pressed=true]:hover:not(:disabled)]:text-danger-ink",
  "[&[data-slot=button][aria-pressed=true]:hover:not(:disabled)]:brightness-[1.08]",
].join(" ")

/**
 * Recording toggle, promoted out of the actions menu so the control is visible
 * on the card itself. Rendered only for statuses whose action set carries a
 * recording toggle; an engine with `can_record === false` renders it disabled.
 */
export function SessionRecordingButton({
  session,
  size = "sm",
}: {
  readonly session: Session
  readonly size?: ButtonSize
}) {
  const queryClient = useQueryClient()
  const engines = useEngines()

  const actions = getStatusDescriptor(session.status).sessionActions
  const enable = actions.includes("enable-recording")
  const disable = actions.includes("disable-recording")
  const engine = engines.find((item) => item.id === session.engine_id)
  const canRecord = engine === undefined || engine.capabilities?.can_record !== false

  const record = useMutation({
    mutationFn: (next: boolean) => setSessionRecording(session.id, next),
    onSuccess: (_data, next) => {
      toast.success(next ? "Recording enabled" : "Recording disabled", `#${session.id}`)
      void queryClient.invalidateQueries({ queryKey: queryRoots.sessions })
      void queryClient.invalidateQueries({ queryKey: queryKeys.session(session.id) })
    },
    onError: (error) => toast.error("Could not change recording", getErrorMessage(error, "Request failed")),
  })

  if (!enable && !disable) return null
  if (!canRecord) {
    return (
      <Button
        size={size}
        variant="ghost"
        icon={<IconDisc size={15} />}
        disabled
        title="This engine cannot record"
      >
        Record
      </Button>
    )
  }

  return (
    <Button
      size={size}
      variant="ghost"
      className={RECORD_TOGGLE}
      icon={<IconDisc size={15} />}
      loading={record.isPending}
      aria-pressed={disable}
      title={enable ? "Enable recording" : "Disable recording"}
      onClick={() => record.mutate(enable)}
    >
      {enable ? "Record" : "Recording"}
    </Button>
  )
}
