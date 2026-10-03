import { useEffect, useState } from "react"
import { Button } from "@/components/ui/Button"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { OverflowMenu, type OverflowMenuItem } from "@/components/ui/OverflowMenu"
import { Switch } from "@/components/ui/Switch"
import { RowActions } from "@/components/ui/Table"
import { getStatusDescriptor } from "@/lib/status-map"
import type { Session } from "@/lib/schemas"
import { SaveAsProfileDialog } from "@/views/shared/parts"
import type { SessionCommands } from "./session-commands"

export interface SessionActionClusterProps {
  readonly session: Session
  readonly canRecord: boolean
  readonly commands: SessionCommands
  readonly variant: "row" | "detail"
}

/**
 * Row/detail action cluster. STATUs_MAP (§1.4) owns the action set: an action
 * absent for a status is never rendered — not disabled (§11.17). Row variant is
 * the §6.4 cluster (up to two direct secondary actions + one overflow); detail
 * variant surfaces stop / recording / delete inline.
 */
export function SessionActionCluster({ session, canRecord, commands, variant }: SessionActionClusterProps) {
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
  const [saveBusy, setSaveBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Pending "Stopping…" ends when the authoritative snapshot flips status.
  useEffect(() => {
    commands.acknowledgeStatus(session)
  }, [commands, session])

  const openSave = () => {
    setSaveError(null)
    setSaveOpen(true)
  }

  const primary = (() => {
    if (state.deleting) return <span className="ve-note">Deleting…</span>
    if (hasStop) {
      return (
        <Button variant="secondary" loading={state.stopPending} onClick={() => setStopConfirm(true)}>
          {state.stillStopping ? "Still stopping…" : "Stop"}
        </Button>
      )
    }
    if (hasSave) {
      return (
        <Button variant="secondary" onClick={openSave}>
          Save as profile
        </Button>
      )
    }
    return null
  })()

  const menuItems: OverflowMenuItem[] = []
  if (hasStop) menuItems.push({ id: "stop", label: "Stop", onSelect: () => setStopConfirm(true) })
  if (hasToggle) {
    menuItems.push({
      id: "recording",
      label: session.recording === true ? "Disable recording" : "Enable recording",
      disabled: state.recPending || !canRecord,
      disabledReason: canRecord ? undefined : "Engine cannot record",
      onSelect: () => void commands.toggleRecording(session),
    })
  }
  if (hasSave) menuItems.push({ id: "save", label: "Save as profile", onSelect: openSave })
  if (hasDelete) menuItems.push({ id: "delete", label: "Delete", destructive: true, onSelect: () => setDeleteConfirm(true) })

  const cluster = (
    <>
      {primary}
      {hasToggle && variant === "detail" ? (
        <Switch
          label={`Recording on session #${session.id}`}
          showLabel
          checked={session.recording === true}
          pending={state.recPending}
          disabled={!canRecord}
          disabledReason={canRecord ? undefined : "Engine cannot record — enable it in the engine plugin"}
          onChange={() => void commands.toggleRecording(session)}
        />
      ) : null}
      {variant === "detail" && hasDelete ? (
        <Button variant="danger-text" onClick={() => setDeleteConfirm(true)}>
          Delete
        </Button>
      ) : null}
      {menuItems.length > 0 ? (
        <OverflowMenu items={menuItems} triggerLabel={`Actions for session #${session.id}`} />
      ) : null}
    </>
  )

  return (
    <>
      {variant === "row" ? <RowActions>{cluster}</RowActions> : <div className="ve-inline">{cluster}</div>}

      <ConfirmDialog
        open={stopConfirm}
        onClose={() => setStopConfirm(false)}
        onConfirm={() => {
          setStopConfirm(false)
          void commands.stop(session)
        }}
        title={`Stop session #${session.id}?`}
        body={<p>The supervisor stops the capture and any recording is finalized.</p>}
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
              <p>A recording is running — the server stops it, then removes the session.</p>
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
        busy={saveBusy}
        error={saveError}
        onClose={() => setSaveOpen(false)}
        onSave={async (name) => {
          setSaveBusy(true)
          const ok = await commands.saveAsProfile(session, name)
          setSaveBusy(false)
          if (ok) setSaveOpen(false)
          else setSaveError("Could not save profile — try another name")
        }}
      />
    </>
  )
}
