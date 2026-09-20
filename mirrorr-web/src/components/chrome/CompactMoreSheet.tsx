/**
 * The More sheet (spec L499): the compact-only destinations and account rows
 * behind the fifth tab slot, reusing the Dialog primitive (bottom-sheet
 * presentation is todo 26). Navigation rows are the spec's list — Plugins,
 * Import/Export, Settings, plus Settings → Users / API clients for admins —
 * then the display name, Change password and Log out. Log out is the same
 * `signOut()` the desktop user menu calls.
 */
import { Link } from "@tanstack/react-router"
import { ArrowLeftRight, KeyRound, LogOut, Puzzle, Settings, Users } from "lucide-react"
import { useState, useSyncExternalStore } from "react"
import { Dialog } from "@/components/ui/Dialog"
import { FOCUS_RING } from "@/components/ui/focus-ring"
import { getAuthState, signOut, subscribeToAuth } from "@/lib/auth-store"

const ROW_CLASS = [
  "flex h-11 w-full items-center gap-3 rounded-control px-2 text-left text-body text-text-secondary",
  "hover:bg-bg-raised hover:text-text-primary disabled:pointer-events-none disabled:opacity-40",
  FOCUS_RING,
].join(" ")

export interface CompactMoreSheetProps {
  readonly open: boolean
  readonly onClose: () => void
}

export function CompactMoreSheet({ open, onClose }: CompactMoreSheetProps) {
  const state = useSyncExternalStore(subscribeToAuth, getAuthState, getAuthState)
  const [pending, setPending] = useState(false)

  const isAdmin = state.user?.role === "admin"
  const displayName =
    state.user?.display_name?.trim() || state.user?.username || state.client?.name || "Account"

  async function handleLogout(): Promise<void> {
    setPending(true)
    await signOut()
    setPending(false)
  }

  return (
    <Dialog open={open} onClose={onClose} title="More">
      <div data-testid="compact-more-sheet" className="flex flex-col gap-1">
        <Link to="/plugins" className={ROW_CLASS} onClick={onClose}>
          <Puzzle aria-hidden="true" strokeWidth={2} className="size-[var(--icon-default)]" />
          Plugins
        </Link>
        <Link to="/import-export" className={ROW_CLASS} onClick={onClose}>
          <ArrowLeftRight aria-hidden="true" strokeWidth={2} className="size-[var(--icon-default)]" />
          Import/Export
        </Link>
        <Link to="/settings" className={ROW_CLASS} onClick={onClose}>
          <Settings aria-hidden="true" strokeWidth={2} className="size-[var(--icon-default)]" />
          Settings
        </Link>
        {isAdmin ? (
          <>
            <Link to="/settings/users" className={ROW_CLASS} onClick={onClose}>
              <Users aria-hidden="true" strokeWidth={2} className="size-[var(--icon-default)]" />
              Users
            </Link>
            <Link to="/settings/clients" className={ROW_CLASS} onClick={onClose}>
              <KeyRound aria-hidden="true" strokeWidth={2} className="size-[var(--icon-default)]" />
              API clients
            </Link>
          </>
        ) : null}
        <div className="my-1 border-t border-border" />
        <div
          data-testid="compact-more-display-name"
          className="flex h-11 items-center px-2 text-body text-text-primary"
        >
          {displayName}
        </div>
        <Link to="/settings" className={ROW_CLASS} onClick={onClose}>
          <KeyRound aria-hidden="true" strokeWidth={2} className="size-[var(--icon-default)]" />
          Change password
        </Link>
        <button type="button" disabled={pending} className={ROW_CLASS} onClick={() => void handleLogout()}>
          <LogOut aria-hidden="true" strokeWidth={2} className="size-[var(--icon-default)]" />
          Log out
        </button>
      </div>
    </Dialog>
  )
}
