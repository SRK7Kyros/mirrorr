import { useCallback, useEffect, useRef, useState } from "react"
import { COUNTDOWN_TICK_MS, formatDuration, parseNaiveUtc } from "@/api/time"

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

export function useFormattedDuration(
  startedAt: string | null | undefined,
  endedAt: string | null | undefined,
): string {
  const seconds = useLiveDurationSeconds(startedAt, endedAt)
  return seconds === null ? "—" : formatDuration(seconds)
}

/** `true` below the 640px compact breakpoint. */
export function useIsCompact(): boolean {
  const [compact, setCompact] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false
    return window.matchMedia("(max-width: 639px)").matches
  })
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return
    const query = window.matchMedia("(max-width: 639px)")
    const onChange = () => setCompact(query.matches)
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
  }, [])
  return compact
}

/** `?highlight=<id>` → scroll the matching row/card into view + 2s accent ring. */
export function useHighlightRef(highlightId: number | null | undefined) {
  const done = useRef(false)
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
