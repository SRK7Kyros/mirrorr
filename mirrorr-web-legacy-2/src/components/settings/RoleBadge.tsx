/**
 * RoleBadge — the V11/V12 "role badge" (spec L365, L380). Administrator and
 * member read differently, so the badge is never colour-only.
 */

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrator",
  user: "User",
}

export interface RoleBadgeProps {
  readonly role: string
}

export function RoleBadge({ role }: RoleBadgeProps) {
  const isAdmin = role === "admin"

  return (
    <span
      data-testid="role-badge"
      data-role={role}
      className={[
        "inline-flex items-center rounded-pill border px-2 py-0.5 text-micro font-medium",
        isAdmin ? "border-accent/30 bg-accent/12 text-accent" : "border-neutral/30 bg-neutral/12 text-neutral-chip-text",
      ].join(" ")}
    >
      {ROLE_LABELS[role] ?? role}
    </span>
  )
}
