/**
 * Todo 21 (spec L171): "resume WS on next successful poll". Once the realtime
 * manager reports `offline` a successful, non-stale entity poll (the visible
 * list / open detail the 15s fallback drives) triggers one `retryRealtimeNow()`
 * — so the fallback closes the loop without the operator pressing Retry.
 *
 * Liveness probes (`health`, `auth/me`) never resume: they succeed whenever the
 * API is reachable, which would silently undo the reconnect ceiling instead of
 * letting the fallback poll own the recovery.
 */
import { retryRealtimeNow } from "@/lib/realtime-manager"
import {
  getRealtimeStatus,
  subscribeToRealtimeStatus,
  type RealtimeStatus,
} from "@/lib/realtime-status"

/** The entity-query roots the 15s fallback polls (spec L140, L171). */
const RESUMABLE_QUERY_ROOTS: ReadonlySet<unknown> = new Set([
  "sessions",
  "session",
  "autoruns",
  "autorun",
  "recordings",
  "profiles",
  "profile",
])

/**
 * The structural slice of `QueryCache`/`Query` this installer reads, so tests
 * can drive it without a live React tree.
 */
export interface RealtimeResumeCacheEvent {
  readonly type: string
  readonly query: {
    readonly queryKey: readonly unknown[]
    readonly state: {
      readonly status: string
      readonly fetchStatus: string
      readonly dataUpdatedAt: number
    }
  }
}

export interface RealtimeResumeCache {
  subscribe: (listener: (event: RealtimeResumeCacheEvent) => void) => () => void
}

export interface RealtimeResumeOptions {
  readonly queryCache: RealtimeResumeCache
  readonly subscribeStatus?: (listener: () => void) => () => void
  readonly getStatus?: () => RealtimeStatus
  readonly resume?: () => void
  readonly now?: () => number
  readonly shouldResume?: (queryKey: readonly unknown[]) => boolean
}

export function installRealtimeResume(options: RealtimeResumeOptions): () => void {
  const subscribeStatus = options.subscribeStatus ?? subscribeToRealtimeStatus
  const getStatus = options.getStatus ?? getRealtimeStatus
  const resume = options.resume ?? retryRealtimeNow
  const now = options.now ?? Date.now
  const shouldResume =
    options.shouldResume ??
    ((queryKey: readonly unknown[]) => RESUMABLE_QUERY_ROOTS.has(queryKey[0]))

  let offlineSince: number | null = null
  let lastResumeAt = 0

  const syncStatus = (): void => {
    if (getStatus() !== "offline") {
      offlineSince = null
      lastResumeAt = 0
      return
    }
    if (offlineSince === null) offlineSince = now()
  }
  syncStatus()

  const unsubscribeStatus = subscribeStatus(syncStatus)
  const unsubscribeCache = options.queryCache.subscribe((event) => {
    if (event.type !== "updated" || offlineSince === null || getStatus() !== "offline") return
    const { query } = event
    if (!shouldResume(query.queryKey)) return
    if (query.state.status !== "success" || query.state.fetchStatus !== "idle") return
    const updatedAt = query.state.dataUpdatedAt
    if (updatedAt <= offlineSince || updatedAt <= lastResumeAt) return
    lastResumeAt = updatedAt
    resume()
  })

  return () => {
    unsubscribeCache()
    unsubscribeStatus()
  }
}
