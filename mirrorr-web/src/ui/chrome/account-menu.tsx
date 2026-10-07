import { useNavigate } from "@tanstack/react-router"
import { logout, useAuthState } from "@/api"
import {
  Avatar,
  IconLogout,
  IconSettings,
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
    <div className="menu-anchor" ref={wrapRef}>
      <button
        type="button"
        className="account-btn"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Avatar name={identity.name} small />
      </button>
      <MenuPopover open={open} onClick={() => setOpen(false)}>
        <div className="menu-identity">
          <div className="menu-identity-name">{identity.name}</div>
          {identity.role !== "" ? <div className="menu-identity-role">{identity.role}</div> : null}
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
