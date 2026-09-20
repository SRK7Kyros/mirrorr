/**
 * The single compact FAB (spec L497): a 56px circular accent button at
 * `right:16px; bottom: calc(56px + env(safe-area-inset-bottom) + 16px)`, whose
 * presence comes from the centralized flag/omit rules. The slot keeps
 * `COMPACT_PRIMARY_ACTION_ID`, so a view's own `PrimaryAction` child becomes
 * the FAB and answers the action instead of the default button — the shell and
 * the view never fork. When no view has registered a handler the click is a
 * no-op until todo 26 wires V3/V5/V8/V12/V13 onto the registry.
 */
import { useLocation } from "@tanstack/react-router"
import { Plus } from "lucide-react"
import { FOCUS_RING } from "@/components/ui/focus-ring"
import {
  COMPACT_PRIMARY_ACTION_ID,
  useHasViewPrimaryAction,
} from "@/components/chrome/CompactShell"
import { invokeCompactAction } from "@/lib/compact-actions"
import { compactFabForPath, type CompactFabActionId } from "@/lib/compact-nav"

export function CompactFab() {
  const location = useLocation()
  const rule = compactFabForPath(location.pathname)

  if (rule.kind === "omit") return null

  return (
    <div
      id={COMPACT_PRIMARY_ACTION_ID}
      data-testid="compact-primary-action"
      className="pointer-events-none fixed right-4 bottom-18 z-40 [&>*]:pointer-events-auto"
    >
      <CompactFabButton id={rule.id} label={rule.label} />
    </div>
  )
}

function CompactFabButton({ id, label }: { readonly id: CompactFabActionId; readonly label: string }) {
  const hasViewAction = useHasViewPrimaryAction()
  if (hasViewAction) return null

  return (
    <button
      type="button"
      data-testid="compact-fab"
      aria-label={label}
      title={label}
      onClick={() => {
        invokeCompactAction(id)
      }}
      className={[
        "flex size-14 items-center justify-center rounded-pill bg-accent text-bg-base shadow-overlay",
        "hover:bg-accent-hover active:brightness-[0.92]",
        FOCUS_RING,
      ].join(" ")}
    >
      <Plus aria-hidden="true" strokeWidth={2} className="size-6" />
    </button>
  )
}
