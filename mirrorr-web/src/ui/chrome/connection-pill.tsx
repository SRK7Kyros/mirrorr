import { API_CLIENT_POLL_LABEL, isApiClientPrincipal, useAuthState, useRealtimeState } from "@/api"
import type { RealtimeSocketState } from "@/api/realtime/manager"

const LABELS: Record<RealtimeSocketState, string> = {
  open: "Live",
  connecting: "Connecting",
  reconnecting: "Reconnecting",
  polling: "Polling",
  closed: "Offline",
  skipped: "Idle",
}

export function ConnectionPill() {
  const auth = useAuthState()
  const realtime = useRealtimeState()

  if (isApiClientPrincipal(auth.auth)) {
    return (
      <span className="conn" data-state="polling" title={API_CLIENT_POLL_LABEL}>
        <span className="conn-dot" aria-hidden="true" />
        Polling
      </span>
    )
  }

  const state = realtime.events
  return (
    <span className="conn" data-state={state} title={`Event stream: ${LABELS[state]}`}>
      <span className="conn-dot" aria-hidden="true" />
      {LABELS[state]}
    </span>
  )
}
