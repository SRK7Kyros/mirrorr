import { useAuthState } from "@/api"
import { Drawer } from "@/ui/components"
import { describeIdentity } from "./identity"
import { NavList } from "./nav-list"
import { UserCard } from "./user-card"

export function MobileNavDrawer({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const auth = useAuthState()
  const identity = describeIdentity(auth.auth)
  return (
    <Drawer
      open={open}
      onClose={onClose}
      side="left"
      title="Mirrorr"
      footer={<UserCard displayName={identity.name} role={identity.role} onNavigate={onClose} />}
    >
      <div className="stack stack-sm">
        <NavList onNavigate={onClose} />
      </div>
    </Drawer>
  )
}
