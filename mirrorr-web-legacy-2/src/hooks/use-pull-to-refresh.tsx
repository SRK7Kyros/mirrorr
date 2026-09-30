/**
 * Todo 25 (spec L506): the pull-to-refresh gesture, bound to the compact scroll
 * region. Spread `handlers` onto the scrolling element and render `indicator`
 * inside it. A pull only starts at scrollTop 0, only counts downward movement,
 * and its only consequence is `refetchForPullToRefresh` — no request of its
 * own, no write.
 */
import { useQueryClient } from "@tanstack/react-query"
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"
import { isRefreshArmed, pullDistance, refetchForPullToRefresh } from "@/lib/pull-to-refresh"

export interface PullToRefreshHandlers {
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  readonly onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
  readonly onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void
  readonly onPointerCancel: () => void
}

export interface PullToRefreshState {
  readonly handlers: PullToRefreshHandlers
  readonly indicator: ReactNode
  readonly armed: boolean
}

export function usePullToRefresh(enabled: boolean): PullToRefreshState {
  const client = useQueryClient()
  const [distance, setDistance] = useState(0)
  const startY = useRef<number | null>(null)
  const armed = enabled && isRefreshArmed(distance)

  function endPull(): void {
    startY.current = null
    setDistance(0)
  }

  const handlers: PullToRefreshHandlers = {
    onPointerDown: (event) => {
      if (!enabled) return
      if (event.currentTarget.scrollTop > 0) return
      startY.current = event.clientY
    },
    onPointerMove: (event) => {
      const start = startY.current
      if (start === null) return
      setDistance(pullDistance(start, event.clientY))
    },
    onPointerUp: () => {
      const start = startY.current
      if (start === null) return
      const released = distance
      endPull()
      if (!enabled || !isRefreshArmed(released)) return
      refetchForPullToRefresh(client)
    },
    onPointerCancel: endPull,
  }

  const indicator =
    enabled && distance > 0 ? (
      <div
        data-testid="pull-to-refresh-indicator"
        role="status"
        aria-live="polite"
        className="flex h-8 items-center justify-center text-small text-text-muted"
      >
        {armed ? "Release to refresh" : "Pull to refresh"}
      </div>
    ) : null

  return { handlers, indicator, armed }
}
