import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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

/** A value that settles only once it stops changing (debounced server search). */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return settled
}

/**
 * Caps Lock is on for the field being typed into.
 *
 * A wrong-password error on a password field is ambiguous: the user may be
 * mistyping a correct password. Reading the modifier on key events is the only
 * way a browser exposes it, and it must be read on both keydown and keyup —
 * toggling the lock itself only fires a keydown.
 */
export function useCapsLock(): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const read = (event: KeyboardEvent) => setOn(event.getModifierState?.("CapsLock") === true)
    window.addEventListener("keydown", read)
    window.addEventListener("keyup", read)
    return () => {
      window.removeEventListener("keydown", read)
      window.removeEventListener("keyup", read)
    }
  }, [])
  return on
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
  /**
   * Drop every selection whose row is no longer on screen. Call it whenever the
   * visible id set changes (a filter, a search, a narrower scope): otherwise
   * "Delete 4 selected" still carries cards the user cannot see.
   */
  const retain = useCallback((ids: readonly T[]) => {
    setSelected((current) => {
      const allowed = new Set(ids)
      let dropped = false
      for (const id of current) {
        if (!allowed.has(id)) {
          dropped = true
          break
        }
      }
      if (!dropped) return current
      return new Set([...current].filter((id) => allowed.has(id)))
    })
  }, [])
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
    retain,
    clear,
    allSelected,
    someSelected,
  }
}

/**
 * Selection bound to the rows a page is actually showing.
 *
 * `useSelection` alone keeps ids that a filter, a search or a narrower scope has
 * scrolled out of existence — the bulk bar still says "Delete 4 selected" and
 * deletes cards the user cannot see. This wrapper prunes on every visible-set
 * change and reports how many selected ids fell outside it, so the UI can say
 * "2 outside this filter" instead of silently lying.
 */
export function useScopedSelection<T extends number | string>(visibleIds: readonly T[]) {
  const selection = useSelection<T>()
  const retain = selection.retain

  useEffect(() => {
    retain(visibleIds)
  }, [visibleIds, retain])

  const outside = useMemo(() => {
    const visible = new Set(visibleIds)
    let count = 0
    for (const id of selection.selected) {
      if (!visible.has(id)) count += 1
    }
    return count
  }, [selection.selected, visibleIds])

  return { ...selection, outside }
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

/** Live `matchMedia` result. jsdom has no `matchMedia`, so an unknown answer is `false`. */
export function useMediaQuery(query: string): boolean {
  const read = () =>
    typeof window === "undefined" || typeof window.matchMedia !== "function"
      ? false
      : window.matchMedia(query).matches
  const [matches, setMatches] = useState(read)

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return
    const list = window.matchMedia(query)
    const onChange = () => setMatches(list.matches)
    setMatches(list.matches)
    list.addEventListener("change", onChange)
    return () => list.removeEventListener("change", onChange)
  }, [query])

  return matches
}
