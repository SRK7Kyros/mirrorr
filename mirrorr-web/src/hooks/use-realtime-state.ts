import { useCallback, useRef, useSyncExternalStore } from "react"
import {
  getRealtimeState,
  subscribeRealtimeState,
  type RealtimeState,
} from "@/lib/realtime-manager"

/**
 * Realtime store subscription. `getRealtimeState()` returns a fresh object
 * every call, so the last snapshot is cached and only replaced when the
 * fields actually change — otherwise useSyncExternalStore would loop.
 */
export function useRealtimeState(): RealtimeState {
  const cacheRef = useRef<RealtimeState | null>(null)
  const getSnapshot = useCallback((): RealtimeState => {
    const next = getRealtimeState()
    const prev = cacheRef.current
    if (
      prev !== null &&
      prev.events === next.events &&
      prev.notifications === next.notifications &&
      prev.attempts === next.attempts &&
      prev.pollingFallback === next.pollingFallback
    ) {
      return prev
    }
    cacheRef.current = next
    return next
  }, [])
  return useSyncExternalStore(subscribeRealtimeState, getSnapshot, getSnapshot)
}
