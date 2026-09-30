import { Dialog } from "@/components/ui/Dialog"
import { FOCUS_RING } from "@/components/ui/focus-ring"

export interface ActionSheetItem {
  readonly id: string
  readonly label: string
  readonly tone?: "default" | "danger"
  readonly disabled?: boolean
  readonly onSelect: () => void
}

export interface ActionSheetProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly title: string
  readonly items: readonly ActionSheetItem[]
}

/**
 * ActionSheet — spec L558: a compact-only presentation wrapper, not a new
 * action model. The caller passes the same action set its desktop overflow
 * menu renders; this component only orders destructive entries last and
 * `--danger`-tints them. Each entry's own confirmation still runs after it,
 * so the destructive path stays as long as it is on desktop.
 */
export function ActionSheet({ open, onClose, title, items }: ActionSheetProps) {
  const ordered = [...items].sort(
    (a, b) => Number(a.tone === "danger") - Number(b.tone === "danger"),
  )

  return (
    <Dialog open={open} onClose={onClose} title={title} size="confirm">
      <ul data-testid="action-sheet" className="flex flex-col gap-1">
        {ordered.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              data-testid={`action-sheet-${item.id}`}
              disabled={item.disabled}
              onClick={() => {
                onClose()
                item.onSelect()
              }}
              className={[
                "flex h-12 w-full items-center rounded-control px-3 text-left text-body hover:bg-bg-raised",
                `${FOCUS_RING} disabled:opacity-50`,
                item.tone === "danger" ? "text-danger" : "text-text-primary",
              ].join(" ")}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
