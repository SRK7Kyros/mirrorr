/**
 * Session row actions — driven strictly by `sessionActionsFor` (spec L199-L221).
 *
 * Inline actions render as buttons; `overflow: true` actions live in the row
 * menu. Pending actions (stop / recording toggle / delete) come from the
 * entity store: Stop shows "Stopping…" until the WS snapshot clears it, the
 * toggle shows a spinner, delete renders the "Deleting…" row state. The 502/504
 * "control unavailable" banner and the post-10s "Still stopping…" escalation
 * both offer the same hard-delete affordance (spec L146-L147, L214-L218).
 */
import { Loader2, MoreHorizontal } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { ActionSheetItem } from "@/components/ui/ActionSheet"
import { Button } from "@/components/ui/Button"
import type { PendingAction } from "@/lib/entity-store"
import type { Session } from "@/lib/schemas/sessions"
import { sessionActionsFor, type StatusAction } from "@/lib/status-map"

export interface SessionRowActionsProps {
  readonly session: Session
  readonly canRecord: boolean
  readonly pending: PendingAction | undefined
  readonly escalated: boolean
  readonly controlUnavailable: boolean
  readonly onStop: () => void
  readonly onToggleRecording: () => void
  readonly onSaveAsProfile: () => void
  readonly onDelete: () => void
  readonly onForceDelete: () => void
}

export function SessionRowActions({
  session,
  canRecord,
  pending,
  escalated,
  controlUnavailable,
  onStop,
  onToggleRecording,
  onSaveAsProfile,
  onDelete,
  onForceDelete,
}: SessionRowActionsProps) {
  if (pending?.kind === "delete") {
    return (
      <span data-testid="row-deleting" className="inline-flex items-center justify-end gap-1 text-small text-text-muted">
        <Loader2 aria-hidden="true" className="size-[var(--icon-row)] animate-spin" />
        Deleting…
      </span>
    )
  }

  const actions = sessionActionsFor(session.status, { canRecord })
  const busy = pending !== undefined
  const stopPending = pending?.kind === "stop"
  const togglePending = pending?.kind === "recording-toggle"

  function run(action: StatusAction) {
    switch (action.id) {
      case "stop":
        onStop()
        return
      case "toggle-recording":
        onToggleRecording()
        return
      case "save-as-profile":
        onSaveAsProfile()
        return
      case "delete":
        onDelete()
        return
      default:
        return
    }
  }

  const inline = actions.filter((action) => !action.overflow)
  const overflow = actions.filter((action) => action.overflow)

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center justify-end gap-1">
        {inline.map((action) => {
          const isStop = action.id === "stop"
          const isToggle = action.id === "toggle-recording"
          const showStopPending = isStop && stopPending
          const showTogglePending = isToggle && togglePending
          const label = showStopPending ? "Stopping…" : action.label

          return (
            <Button
              key={action.id}
              size="sm"
              variant={action.kind === "danger" ? "danger" : "secondary"}
              disabled={action.disabled || busy}
              title={isToggle && !canRecord ? "Engine cannot record" : undefined}
              onClick={() => run(action)}
            >
              {showStopPending || showTogglePending ? (
                <span className="inline-flex items-center gap-1">
                  <Loader2 aria-hidden="true" className="size-[var(--icon-row)] animate-spin" />
                  {label}
                </span>
              ) : (
                label
              )}
            </Button>
          )
        })}
        {overflow.length > 0 ? (
          <OverflowMenu sessionId={session.id} actions={overflow} disabled={busy} onSelect={run} />
        ) : null}
      </div>

      {escalated && stopPending ? (
        <span data-testid="still-stopping" className="flex items-center gap-2 text-small text-warn">
          Still stopping…
          <Button size="sm" variant="danger" onClick={onForceDelete}>
            Force delete
          </Button>
        </span>
      ) : null}

      {controlUnavailable ? (
        <div
          role="alert"
          data-testid="control-unavailable-banner"
          className="flex items-center gap-2 text-small text-danger"
        >
          Control unavailable — session may be stuck
          <Button size="sm" variant="danger" onClick={onForceDelete}>
            Force delete
          </Button>
        </div>
      ) : null}
    </div>
  )
}

interface OverflowMenuProps {
  readonly sessionId: number
  readonly actions: readonly StatusAction[]
  readonly disabled: boolean
  readonly onSelect: (action: StatusAction) => void
}

function OverflowMenu({ sessionId, actions, disabled, onSelect }: OverflowMenuProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return

    function onPointerDown(event: MouseEvent) {
      const container = containerRef.current
      if (container !== null && event.target instanceof Node && !container.contains(event.target)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false)
    }

    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <Button
        size="sm"
        variant="ghost"
        icon={MoreHorizontal}
        iconSize="row"
        aria-label={`More actions for session #${sessionId}`}
        title="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      />
      {open ? (
        <div
          role="menu"
          data-testid="row-overflow-menu"
          className="absolute top-full right-0 z-20 mt-1 min-w-36 rounded-control border border-border bg-bg-overlay p-1 shadow-overlay"
        >
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              className={[
                "block w-full rounded-control px-2 py-1 text-left text-small hover:bg-bg-raised",
                action.kind === "danger" ? "text-danger" : "text-text-primary",
              ].join(" ")}
              onClick={() => {
                setOpen(false)
                onSelect(action)
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export interface SessionActionItemArgs {
  readonly session: Session
  readonly canRecord: boolean
  readonly pending: PendingAction | undefined
  readonly escalated: boolean
  readonly controlUnavailable: boolean
  readonly onStop: () => void
  readonly onToggleRecording: () => void
  readonly onSaveAsProfile: () => void
  readonly onDelete: () => void
  readonly onForceDelete: () => void
}

/**
 * Spec L505/L558: the compact sheet wraps the desktop action set rather than
 * defining a second one — inline entries included, since five 44px buttons do
 * not fit a 360px card. Each entry's ConfirmDialog still runs after the sheet.
 */
export function sessionActionItems(args: SessionActionItemArgs): readonly ActionSheetItem[] {
  const { session, canRecord, pending, escalated, controlUnavailable } = args

  if (pending?.kind === "delete") return []

  const busy = pending !== undefined
  const stopPending = pending?.kind === "stop"

  function run(action: StatusAction) {
    switch (action.id) {
      case "stop":
        args.onStop()
        return
      case "toggle-recording":
        args.onToggleRecording()
        return
      case "save-as-profile":
        args.onSaveAsProfile()
        return
      case "delete":
        args.onDelete()
        return
      default:
        return
    }
  }

  const items: ActionSheetItem[] = sessionActionsFor(session.status, { canRecord }).map((action) => ({
    id: action.id,
    label: action.id === "stop" && stopPending ? "Stopping…" : action.label,
    tone: action.kind === "danger" ? "danger" : undefined,
    disabled: action.disabled || busy,
    onSelect: () => run(action),
  }))

  const forceDelete = (escalated && stopPending) || controlUnavailable
  if (!forceDelete) return items

  return [
    ...items,
    { id: "force-delete", label: "Force delete", tone: "danger", onSelect: args.onForceDelete },
  ]
}
