import { useEffect, useState } from "react"
import { COUNTDOWN_TICK_MS, LIVE_DURATION_TICK_MS } from "@/lib/time"

/**
 * The single timer seam. Not exported on purpose: call sites may only use the
 * two named hooks below, so a 1s cadence cannot exist outside an open session
 * detail (`docs/web-frontend-spec.md` L232).
 */
function useTick(intervalMs: number, enabled: boolean): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    if (!enabled) return undefined
    const handle = window.setInterval(() => setNow(new Date()), intervalMs)
    return () => window.clearInterval(handle)
  }, [enabled, intervalMs])

  return now
}

/** Autorun countdown cadence: recompute every 10s (spec L231). */
export function useCountdownTick(): Date {
  return useTick(COUNTDOWN_TICK_MS, true)
}

/**
 * Live session duration cadence: 1s, and ONLY for an open session detail view
 * (`enabled` must be false everywhere else — spec L232).
 */
export function useLiveDurationTick(enabled: boolean): Date {
  return useTick(LIVE_DURATION_TICK_MS, enabled)
}
