/**
 * Spec L17-L23 (top-bar user menu) and L49: display name, Change password and
 * Log out. Log out posts `POST /auth/logout`, then the store wipes every cache
 * and redirects to `/login` (`signOut`/`clearSession` in `auth-store`).
 */
import { useNavigate } from "@tanstack/react-router"
import { ChevronDown, KeyRound, LogOut } from "lucide-react"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { FOCUS_RING } from "@/components/ui/focus-ring"
import { getAuthState, signOut, subscribeToAuth } from "@/lib/auth-store"

const MENU_ITEM_CLASS = [
  "flex w-full items-center gap-2 px-3 py-2 text-left text-body text-text-secondary",
  "hover:bg-bg-raised hover:text-text-primary disabled:pointer-events-none disabled:opacity-40",
  FOCUS_RING,
].join(" ")

export function UserMenu() {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const state = useSyncExternalStore(subscribeToAuth, getAuthState, getAuthState)

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current !== null && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("pointerdown", handlePointerDown)
    return () => document.removeEventListener("pointerdown", handlePointerDown)
  }, [open])

  const displayName =
    state.user?.display_name?.trim() || state.user?.username || state.client?.name || "Account"

  async function handleLogout(): Promise<void> {
    setPending(true)
    await signOut()
    setPending(false)
  }

  return (
    <div
      ref={containerRef}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false)
      }}
    >
      <button
        type="button"
        data-testid="user-menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={[
          "flex h-8 max-w-48 items-center gap-1.5 rounded-control px-2 text-body text-text-secondary",
          "hover:bg-bg-overlay hover:text-text-primary",
          FOCUS_RING,
        ].join(" ")}
      >
        <span className="truncate">{displayName}</span>
        <ChevronDown aria-hidden="true" strokeWidth={2} className="size-[var(--icon-row)] shrink-0" />
      </button>
      {open ? (
        <div
          data-testid="user-menu"
          role="menu"
          aria-label="User menu"
          className="absolute top-full right-0 z-50 mt-1 w-52 rounded-surface border border-border bg-bg-overlay py-1 shadow-overlay"
        >
          <button
            type="button"
            role="menuitem"
            disabled={pending}
            className={MENU_ITEM_CLASS}
            onClick={() => {
              setOpen(false)
              void navigate({ to: "/settings" })
            }}
          >
            <KeyRound aria-hidden="true" strokeWidth={2} className="size-[var(--icon-row)]" />
            Change password
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={pending}
            className={MENU_ITEM_CLASS}
            onClick={() => void handleLogout()}
          >
            <LogOut aria-hidden="true" strokeWidth={2} className="size-[var(--icon-row)]" />
            Log out
          </button>
        </div>
      ) : null}
    </div>
  )
}
