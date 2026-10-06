import { useNavigate } from "@tanstack/react-router"
import { Avatar } from "@/ui/components"

export function UserCard({
  displayName,
  role,
  onNavigate,
}: {
  readonly displayName: string
  readonly role: string
  readonly onNavigate?: () => void
}) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      className="user-card"
      onClick={() => {
        onNavigate?.()
        void navigate({ to: "/settings" })
      }}
    >
      <Avatar name={displayName} />
      <div className="user-meta">
        <div className="user-name">{displayName}</div>
        {role !== "" ? <div className="user-role">{role}</div> : null}
      </div>
    </button>
  )
}
