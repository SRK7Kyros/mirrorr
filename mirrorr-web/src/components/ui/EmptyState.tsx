import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

/**
 * EmptyState — one implementation, per-view copy as specified (spec L408).
 * `EMPTY_STATES` carries the exact strings for every v1 view so no view
 * restates its own copy.
 */

export const EMPTY_STATES = {
  sessions: "No sessions yet — start your first recording",
  autoruns: "No autoruns — schedule a recording",
  recordings: "No recordings yet — enable recording on a session",
  profiles: "No profiles — save a reusable configuration",
  engines: "No engines installed",
  users: "No users",
  apiClients: "No API clients yet — create one for programmatic access",
} as const

export type EmptyStateKey = keyof typeof EMPTY_STATES

export interface EmptyStateProps {
  readonly title: string
  readonly icon?: LucideIcon
  readonly description?: string
  readonly action?: ReactNode
}

export function EmptyState({ title, icon: Icon, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      {Icon !== undefined ? (
        <Icon
          aria-hidden="true"
          strokeWidth={2}
          className="size-[var(--icon-empty)] text-text-muted"
        />
      ) : null}
      <p className="text-title font-semibold text-text-primary">{title}</p>
      {description !== undefined ? (
        <p className="max-w-prose text-body text-text-secondary">{description}</p>
      ) : null}
      {action !== undefined ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}
