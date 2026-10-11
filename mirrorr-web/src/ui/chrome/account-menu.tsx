import { useNavigate } from "@tanstack/react-router"
import { logout, useAuthState } from "@/api"
import {
  Avatar,
  IconLogout,
  IconSettings,
  menuAnchorClass,
  MenuItem,
  MenuPopover,
  MenuSeparator,
  useMenuDismiss,
} from "@/ui/components"
import { describeIdentity } from "./identity"

export function AccountMenu() {
  const navigate = useNavigate()
  const auth = useAuthState()
  const identity = describeIdentity(auth.auth)
  const { open, setOpen, wrapRef } = useMenuDismiss()

  return (
    <div className={menuAnchorClass} ref={wrapRef}>
      <button
        type="button"
        className="inline-flex p-0 rounded-full transition-[box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:shadow-[0_0_0_2px_var(--border-strong)]"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Avatar name={identity.name} small />
      </button>
      <MenuPopover open={open} onClick={() => setOpen(false)}>
        <div className="py-2 px-3">
          <div className="text-base font-medium text-ink truncate">{identity.name}</div>
          {identity.role !== "" ? (
            <div className="text-xs text-ink-dim [font-family:var(--font-mono)]">{identity.role}</div>
          ) : null}
        </div>
        <MenuSeparator />
        <MenuItem icon={<IconSettings size={16} />} onClick={() => void navigate({ to: "/settings" })}>
          Settings
        </MenuItem>
        <MenuItem danger icon={<IconLogout size={16} />} onClick={() => void logout()}>
          Sign out
        </MenuItem>
      </MenuPopover>
    </div>
  )
}
