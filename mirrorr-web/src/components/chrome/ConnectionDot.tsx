/**
 * Spec L165-L171 and L498: the WS connection indicator is `role="status"` with
 * a visible text label (never colour alone). Todo 18's socket manager drives
 * `setRealtimeStatus`; an API-client principal gets the static polling label
 * instead (spec L154).
 */
import { useSyncExternalStore } from "react"
import {
  getRealtimeStatus,
  REALTIME_STATUS_LABELS,
  subscribeToRealtimeStatus,
  type RealtimeStatus,
} from "@/lib/realtime-status"
import { getAuthState, isApiClientPrincipal, subscribeToAuth } from "@/lib/auth-store"

const DOT_TONE: Readonly<Record<RealtimeStatus, string>> = {
  live: "bg-ok",
  reconnecting: "bg-warn",
  offline: "bg-danger",
}

export interface ConnectionDotProps {
  readonly status: RealtimeStatus
}

export function ConnectionDot({ status }: ConnectionDotProps) {
  return (
    <div
      role="status"
      data-testid="connection-dot"
      data-status={status}
      className="flex items-center gap-2 text-small text-text-secondary"
    >
      <span aria-hidden="true" className={["size-2 shrink-0 rounded-pill", DOT_TONE[status]].join(" ")} />
      <span>{REALTIME_STATUS_LABELS[status]}</span>
    </div>
  )
}

export function RealtimeIndicator() {
  const principal = useSyncExternalStore(subscribeToAuth, getAuthState, getAuthState)
  const status = useSyncExternalStore(
    subscribeToRealtimeStatus,
    getRealtimeStatus,
    getRealtimeStatus,
  )

  if (isApiClientPrincipal(principal)) {
    return (
      <span data-testid="api-client-polling-label" className="text-small text-text-muted">
        API client — polling every 10s
      </span>
    )
  }

  return <ConnectionDot status={status} />
}
