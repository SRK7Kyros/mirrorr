/**
 * Autorun row actions — driven strictly by `autorunActionsFor` (spec L199-L213,
 * L284-L287). The action set is edit / run-now / save-as-profile / delete;
 * delete on a live autorun carries the "A recording is running — deleting will
 * stop and delete it" warning, supplied by the caller's ConfirmDialog.
 */
import { Loader2, MoreHorizontal } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/Button"
import type { PendingAction } from "@/lib/entity-store"
import type { Autorun } from "@/lib/schemas/autoruns"
import { autorunActionsFor, type StatusAction } from "@/lib/status-map"

export interface AutorunRowActionsProps {
  readonly autorun: Autorun
  readonly pending: PendingAction | undefined
  readonly onEdit: () => void
  readonly onRunNow: () => void
  readonly onSaveAsProfile: () => void
  readonly onDelete: () => void
}

export function AutorunRowActions({
  autorun,
  pending,
  onEdit,
  onRunNow,
  onSaveAsProfile,
  onDelete,
}: AutorunRowActionsProps) {
  if (pending?.kind === "delete") {
    return (
      <span data-testid="row-deleting" className="inline-flex items-center justify-end gap-1 text-small text-text-muted">
        <Loader2 aria-hidden="true" className="size-[var(--icon-row)] animate-spin" />
        Deleting…
      </span>
    )
  }

  const actions = autorunActionsFor(autorun.status)
  const busy = pending !== undefined

  function run(action: StatusAction) {
    switch (action.id) {
      case "edit":
        onEdit()
        return
      case "run-now":
        onRunNow()
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

  if (actions.length === 0) return <span className="text-text-muted">—</span>

  const inline = actions.filter((action) => !action.overflow)
  const overflow = actions.filter((action) => action.overflow)

  return (
    <div className="flex items-center justify-end gap-1">
      {inline.map((action) => (
        <Button
          key={action.id}
          size="sm"
          variant={action.kind === "danger" ? "danger" : "secondary"}
          disabled={action.disabled || busy}
          data-testid={`autorun-${autorun.id}-${action.id}`}
          onClick={() => run(action)}
        >
          {action.label}
        </Button>
      ))}
      {overflow.length > 0 ? (
        <OverflowMenu autorunId={autorun.id} actions={overflow} disabled={busy} onSelect={run} />
      ) : null}
    </div>
  )
}

interface OverflowMenuProps {
  readonly autorunId: number
  readonly actions: readonly StatusAction[]
  readonly disabled: boolean
  readonly onSelect: (action: StatusAction) => void
}

function OverflowMenu({ autorunId, actions, disabled, onSelect }: OverflowMenuProps) {
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
        aria-label={`More actions for autorun #${autorunId}`}
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
