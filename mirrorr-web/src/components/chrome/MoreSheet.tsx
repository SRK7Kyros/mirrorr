import { Link } from "@tanstack/react-router"
import { Sheet } from "@/components/ui/Dialog"

export interface MoreSheetProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly onChangePassword?: () => void
  readonly onSignOut?: () => void
}

const moreRows: ReadonlyArray<{ readonly id: string; readonly label: string; readonly to: string }> = [
  { id: "plugins", label: "Plugins", to: "/plugins" },
  { id: "import-export", label: "Import/Export", to: "/import-export" },
  { id: "settings", label: "Settings/Account", to: "/settings" },
]

/**
 * More sheet — §3.3: reached from the TabBar More slot (≤639), holds
 * Plugins · Import/Export · Settings/Account as 48px rows; sheet body
 * scrolls, header/footer stay put (§3 scroll ownership).
 */
export function MoreSheet({ open, onClose, onChangePassword, onSignOut }: MoreSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title="More">
      {moreRows.map((row) => (
        <Link
          key={row.id}
          to={row.to}
          className="sheet__row"
          aria-current={undefined}
          onClick={onClose}
        >
          {row.label}
        </Link>
      ))}
      {onChangePassword !== undefined ? (
        <button
          type="button"
          className="sheet__row"
          onClick={() => {
            onClose()
            onChangePassword()
          }}
        >
          Change password
        </button>
      ) : null}
      {onSignOut !== undefined ? (
        <button
          type="button"
          className="sheet__row sheet__row--destructive"
          onClick={() => {
            onClose()
            onSignOut()
          }}
        >
          Log out
        </button>
      ) : null}
    </Sheet>
  )
}
