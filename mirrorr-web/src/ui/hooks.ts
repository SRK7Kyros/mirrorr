import { useCallback, useEffect, useRef, useState } from "react"
import { COUNTDOWN_TICK_MS, parseNaiveUtc } from "@/api/time"

/**
 * UI-only hooks. These are presentation concerns (clocks, breakpoints, scroll
 * highlighting) and deliberately live outside `@/api` so the API layer has no
 * rendering dependencies.
 */

/** A `Date` that re-renders on an interval (countdowns, "last seen"). */
export function useNowTick(intervalMs: number = COUNTDOWN_TICK_MS): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

/** Live session duration in seconds (1s tick while running). */
export function useLiveDurationSeconds(
  startedAt: string | null | undefined,
  endedAt: string | null | undefined,
): number | null {
  const running = (startedAt ?? "") !== "" && (endedAt ?? "") === ""
  const [seconds, setSeconds] = useState<number | null>(null)

  useEffect(() => {
    const compute = () => {
      if ((startedAt ?? "") === "") {
        setSeconds(null)
        return
      }
      const start = parseNaiveUtc(startedAt as string).getTime()
      const end = (endedAt ?? "") === "" ? Date.now() : parseNaiveUtc(endedAt as string).getTime()
      setSeconds(Math.max(0, Math.floor((end - start) / 1000)))
    }
    compute()
    if (!running) return
    const timer = setInterval(compute, 1000)
    return () => clearInterval(timer)
  }, [startedAt, endedAt, running])

  return seconds
}

/** Multi-select state for list views — a set of ids plus select-all/clear. */
export function useSelection<T extends number | string>() {
  const [selected, setSelected] = useState<ReadonlySet<T>>(() => new Set<T>())

  const toggle = useCallback((id: T) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const setMany = useCallback((ids: readonly T[]) => setSelected(new Set(ids)), [])
  const clear = useCallback(() => setSelected(new Set<T>()), [])
  const has = useCallback((id: T) => selected.has(id), [selected])
  const allSelected = useCallback(
    (ids: readonly T[]) => ids.length > 0 && ids.every((id) => selected.has(id)),
    [selected],
  )
  const someSelected = useCallback((ids: readonly T[]) => ids.some((id) => selected.has(id)), [selected])

  return {
    selected,
    count: selected.size,
    has,
    toggle,
    setMany,
    clear,
    allSelected,
    someSelected,
  }
}

/** `?highlight=<id>` → scroll the matching row/card into view + 2s accent ring. */
export function useHighlightRef(highlightId: number | null | undefined) {
  const done = useRef(false)
  useEffect(() => {
    done.current = false
  }, [highlightId])
  return useCallback(
    (element: HTMLElement | null) => {
      if (element === null || highlightId == null || done.current) return
      const elId = element.dataset.id ?? element.dataset.rowId
      if (elId !== String(highlightId)) return
      done.current = true
      element.dataset.highlight = "true"
      element.scrollIntoView({ block: "center" })
      window.setTimeout(() => {
        delete element.dataset.highlight
      }, 2000)
    },
    [highlightId],
  )
}
