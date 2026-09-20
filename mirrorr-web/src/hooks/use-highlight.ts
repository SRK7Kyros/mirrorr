/**
 * `?highlight=<id>` support (spec L305, L332): after the target row is on
 * screen the view scrolls it into the middle and rings it for two seconds.
 * The caller renders `data-entity-id` on each row; the hook owns the timer.
 */
import { useEffect, useRef, useState } from "react"

export const HIGHLIGHT_DURATION_MS = 2000

/**
 * Reads `?highlight=<id>` from a router search record. Anything that is not a
 * positive integer id (missing, empty, non-numeric, array) yields `undefined`
 * so the route is identical to a plain visit.
 */
export function parseHighlightSearch(value: unknown): number | undefined {
  const text = typeof value === "number" ? String(value) : value
  if (typeof text !== "string" || text.trim() === "") return undefined
  const parsed = Number(text)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

export interface HighlightState<T extends HTMLElement> {
  /** Attach to the list container that wraps the `data-entity-id` rows. */
  readonly containerRef: React.RefObject<T | null>
  /** The id currently ringed, or `null`. */
  readonly highlightedId: number | null
}

export function useHighlight<T extends HTMLElement>(
  highlightId: number | null,
  presentIds: readonly number[],
): HighlightState<T> {
  const containerRef = useRef<T | null>(null)
  const [highlightedId, setHighlightedId] = useState<number | null>(null)
  const signature = presentIds.join(",")

  useEffect(() => {
    if (highlightId === null) return
    const container = containerRef.current
    if (container === null) return
    const row = container.querySelector<HTMLElement>(`[data-entity-id="${highlightId}"]`)
    if (row === null) return
    if (typeof row.scrollIntoView === "function") row.scrollIntoView({ block: "center" })
    setHighlightedId(highlightId)
    const timer = setTimeout(() => setHighlightedId(null), HIGHLIGHT_DURATION_MS)
    return () => clearTimeout(timer)
  }, [highlightId, signature])

  return { containerRef, highlightedId }
}
