import { useEffect, useState } from "react"
import { Button } from "@/components/ui/Button"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { OverflowMenu, type OverflowMenuItem } from "@/components/ui/OverflowMenu"
import { Switch } from "@/components/ui/Switch"
import { getStatusDescriptor } from "@/lib/status-map"
import type { Session } from "@/lib/schemas"
import { SaveAsProfileDialog } from "@/views/shared/parts"
import { useIsCompact } from "@/views/shared/hooks"
import type { SessionCommands } from "./session-commands"

export interface SessionActionClusterProps {
  readonly session: Session
  readonly canRecord: boolean
  readonly commands: SessionCommands
  readonly variant: "row" | "detail"
}

/**
 * Row/detail action cluster. STATUS_MAP owns the action set: `delete` absent
 * ⇒ never rendered (not disabled); primary = Stop (danger-text) or Save as
 * profile; recording = Switch (disabled-but-visible when can_record=false);
 * overflow holds the rest (all actions on compact, where the primary hides).
 */
export function SessionActionCluster({
  session,
  canRecord,
  commands,
  variant,
}: SessionActionClusterProps) {
  const compact = useIsCompact()
  const state = commands.stateOf(session.id)
  const descriptor = getStatusDescriptor(session.status)
  const actions = descriptor.sessionActions

  const hasStop = actions.includes("stop")
  const hasSave = actions.includes("save-as-profile")
  const hasDelete = actions.includes("delete")
  const hasToggle = actions.includes("enable-recording") || actions.includes("disable-recording")

  const [stopConfirm, setStopConfirm] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Pending "Stopping…" ends when the authoritative snapshot flips status.
  useEffect(() => {
    commands.acknowledgeStatus(session)
  }, [commands, session])

  const primary = (() => {
    if (state.deleting) {
      return <span className="t-meta">Deleting…</span>
    }
    if (hasStop) {
      return (
        <Button
          variant="danger-text"
          className="row-primary-action"
          loading={state.stopPending}
          onClick={() => setStopConfirm(true)}
        >
          {state.stillStopping ? "still stopping…" : "Stop"}
        </Button>
      )
    }
    if (hasSave) {
      return (
        <Button
          variant="ghost"
          className="row-primary-action"
          onClick={() => {
            setSaveError(null)
            setSaveOpen(true)
          }}
        >
          Save as profile
        </Button>
      )
    }
    return null
  })()

  const buildItems = (): OverflowMenuItem[] => {
    const items: OverflowMenuItem[] = []
    const primaryAction = hasStop ? "stop" : hasSave ? "save-as-profile" : null
    const includeAll = compact
    if (hasStop && (includeAll || primaryAction !== "stop")) {
      items.push({ id: "stop", label: "Stop", onSelect: () => setStopConfirm(true) })
    }
    if (hasToggle) {
      items.push({
        id: "recording",
        label: session.recording === true ? "Disable recording" : "Enable recording",
        disabled: state.recPending || !canRecord,
        onSelect: () => void commands.toggleRecording(session),
      })
    }
    if (hasSave && (includeAll || primaryAction !== "save-as-profile")) {
      items.push({
        id: "save",
        label: "Save as profile",
        onSelect: () => {
          setSaveError(null)
          setSaveOpen(true)
        },
      })
    }
    if (hasDelete) {
      items.push({
        id: "delete",
        label: "Delete",
        destructive: true,
        onSelect: () => setDeleteConfirm(true),
      })
    }
    return items
  }

  const menuItems = buildItems()

  return (
    <>
      <span className="cluster" data-variant={variant}>
        {primary}
        {hasToggle ? (
          <Switch
            label={
              session.recording === true
                ? `Disable recording on session #${session.id}`
                : `Enable recording on session #${session.id}`
            }
            checked={session.recording === true}
            pending={state.recPending}
            disabled={!canRecord}
            disabledReason={canRecord ? undefined : "Engine cannot record"}
            onChange={() => void commands.toggleRecording(session)}
          />
        ) : null}
        {menuItems.length > 0 ? (
          <OverflowMenu items={menuItems} triggerLabel={`Actions for session #${session.id}`} />
        ) : null}
      </span>

      <ConfirmDialog
        open={stopConfirm}
        onClose={() => setStopConfirm(false)}
        onConfirm={() => {
          setStopConfirm(false)
          void commands.stop(session)
        }}
        title={`Stop session #${session.id}?`}
        body="The recording will finalize."
        confirmLabel="Stop"
        loading={state.stopPending}
      />

      <ConfirmDialog
        open={deleteConfirm}
        onClose={() => setDeleteConfirm(false)}
        onConfirm={() => {
          setDeleteConfirm(false)
          void commands.remove(session)
        }}
        title={`Delete session #${session.id}?`}
        body={
          session.recording === true ? (
            <>
              <p>A recording is running — deleting will stop and delete it.</p>
              <p>This cannot be undone.</p>
            </>
          ) : (
            <p>This cannot be undone.</p>
          )
        }
        tone="destructive"
        confirmLabel="Delete"
        loading={state.deletePending}
      />

      <SaveAsProfileDialog
        open={saveOpen}
        busy={false}
        error={saveError}
        onClose={() => setSaveOpen(false)}
        onSave={async (name) => {
          const ok = await commands.saveAsProfile(session, name)
          if (ok) setSaveOpen(false)
          else setSaveError("Could not save profile — try another name")
        }}
      />
    </>
  )
}
