/**
 * IntersectionObserver auto-load for list sentinels (spec L138: "'Load more'
 * button + IntersectionObserver auto-load").
 *
 * The callback is kept in a ref so the observer is only recreated when the
 * target or the enabled flag changes, never on every render. Environments
 * without IntersectionObserver (jsdom) simply skip auto-load; the "Load more"
 * button remains the fallback.
 */
import { useEffect, useRef, type RefObject } from "react"

export interface AutoLoadOptions {
  readonly enabled: boolean
  readonly onLoad: () => void
}

export function useAutoLoadOnIntersect(
  target: RefObject<Element | null>,
  options: AutoLoadOptions,
): void {
  const onLoadRef = useRef(options.onLoad)
  onLoadRef.current = options.onLoad

  useEffect(() => {
    const element = target.current
    if (!options.enabled || element === null) return
    if (typeof IntersectionObserver === "undefined") return

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onLoadRef.current()
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [target, options.enabled])
}
