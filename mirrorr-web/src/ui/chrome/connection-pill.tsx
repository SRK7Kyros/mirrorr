import { API_CLIENT_POLL_LABEL, isApiClientPrincipal, useAuthState, useRealtimeState } from "@/api"
import type { RealtimeSocketState } from "@/api/realtime/manager"

const CONN_DOT_CLASS = [
  "h-[7px] w-[7px] shrink-0 rounded-full bg-neutral",
  "group-data-[state=open]:bg-success group-data-[state=open]:shadow-[0_0_6px_var(--success)]",
  "group-data-[state=connecting]:bg-warning group-data-[state=connecting]:animate-[dot-pulse_1.2s_var(--ease-in-out)_infinite]",
  "group-data-[state=reconnecting]:bg-warning group-data-[state=reconnecting]:animate-[dot-pulse_1.2s_var(--ease-in-out)_infinite]",
  "group-data-[state=polling]:bg-info",
  "group-data-[state=closed]:bg-danger",
].join(" ")

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
      <span
        className="group inline-flex h-7 items-center gap-2 whitespace-nowrap rounded-full border border-line bg-surface-2 pl-2 pr-3 text-sm text-ink-muted"
        data-state="polling"
        title={API_CLIENT_POLL_LABEL}
      >
        <span className={CONN_DOT_CLASS} aria-hidden="true" />
        Polling
      </span>
    )
  }

  const state = realtime.events
  return (
    <span
      className="group inline-flex h-7 items-center gap-2 whitespace-nowrap rounded-full border border-line bg-surface-2 pl-2 pr-3 text-sm text-ink-muted"
      data-state={state}
      title={`Event stream: ${LABELS[state]}`}
    >
      <span className={CONN_DOT_CLASS} aria-hidden="true" />
      {LABELS[state]}
    </span>
  )
}
