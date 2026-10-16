import { useCallback, useEffect, useRef, useState, type RefObject } from "react"

/**
 * Drag/marquee selection for a scrollable catalog.
 *
 * A pointer gesture decides its axis on the first few pixels of travel: a
 * mostly-horizontal drag sweeps a selection rectangle over the cards marked
 * `data-marquee-key`, while a mostly-vertical drag is abandoned so the browser
 * can scroll the container natively (`touch-action: pan-y` in the caller).
 *
 * While sweeping, a pointer within `EDGE_PX` of the container's top or bottom
 * edge auto-scrolls it every frame, so a selection larger than one screen is
 * still reachable in a single gesture.
 *
 * This is an ENHANCEMENT only: every card is a real button, and the caller also
 * offers tap + select-all + keyboard, so nothing here is the sole route to a
 * selection. Environments without layout (jsdom) simply never start one — the
 * hit test reads rects that are all zero there.
 */

/** Proximity to the scroll edge, in CSS pixels, that starts auto-scroll. */
const EDGE_PX = 48
/** Auto-scroll speed at the very edge, in px per frame. */
const EDGE_MAX_STEP = 20
/** Pointer travel before the gesture's axis is committed. */
const AXIS_THRESHOLD = 6
/** A flat horizontal sweep gets this much height so it still crosses a card row. */
const MIN_BAND = 16

/** The marquee rectangle, in coordinates relative to the scroll container's content. */
export interface MarqueeOverlay {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export function useMarqueeSelection(
  scrollRef: RefObject<HTMLElement | null>,
  onSelect: (keys: readonly string[]) => void,
): { readonly overlay: MarqueeOverlay | null } {
  const [overlay, setOverlay] = useState<MarqueeOverlay | null>(null)
  const selectRef = useRef(onSelect)
  selectRef.current = onSelect

  const gestureRef = useRef<{
    x0: number
    y0: number
    x: number
    y: number
    id: number
    marquee: boolean
    decided: boolean
  } | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastKeys = useRef("\u0000")
  const suppressClick = useRef(false)

  const compute = useCallback(() => {
    const scroll = scrollRef.current
    const gesture = gestureRef.current
    if (scroll === null || gesture === null || !gesture.marquee) return

    const box = scroll.getBoundingClientRect()
    let step = 0
    if (gesture.y < box.top + EDGE_PX) {
      step = -Math.ceil(((box.top + EDGE_PX - gesture.y) / EDGE_PX) * EDGE_MAX_STEP)
    } else if (gesture.y > box.bottom - EDGE_PX) {
      step = Math.ceil(((gesture.y - (box.bottom - EDGE_PX)) / EDGE_PX) * EDGE_MAX_STEP)
    }
    if (step !== 0) scroll.scrollTop += step

    const left = Math.min(gesture.x0, gesture.x)
    const right = Math.max(gesture.x0, gesture.x)
    let top = Math.min(gesture.y0, gesture.y)
    let bottom = Math.max(gesture.y0, gesture.y)
    if (bottom - top < MIN_BAND) {
      const middle = (top + bottom) / 2
      top = middle - MIN_BAND / 2
      bottom = middle + MIN_BAND / 2
    }

    const keys: string[] = []
    for (const element of scroll.querySelectorAll<HTMLElement>("[data-marquee-key]")) {
      const rect = element.getBoundingClientRect()
      if (rect.right > left && rect.left < right && rect.bottom > top && rect.top < bottom) {
        const key = element.dataset.marqueeKey
        if (key !== undefined && key !== "") keys.push(key)
      }
    }
    const signature = keys.join("\u0000")
    if (signature !== lastKeys.current) {
      lastKeys.current = signature
      selectRef.current(keys)
    }

    setOverlay({
      left: left - box.left + scroll.scrollLeft,
      top: top - box.top + scroll.scrollTop,
      width: right - left,
      height: bottom - top,
    })
  }, [scrollRef])

  const computeRef = useRef(compute)
  computeRef.current = compute

  const tick = useCallback(() => {
    rafRef.current = null
    computeRef.current()
    if (gestureRef.current?.marquee === true) rafRef.current = requestAnimationFrame(tick)
  }, [])

  useEffect(() => {
    const scroll = scrollRef.current
    if (scroll === null) return

    const schedule = () => {
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(tick)
    }
    const stop = () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return
      gestureRef.current = {
        x0: event.clientX,
        y0: event.clientY,
        x: event.clientX,
        y: event.clientY,
        id: event.pointerId,
        marquee: false,
        decided: false,
      }
      suppressClick.current = false
    }

    const onPointerMove = (event: PointerEvent) => {
      const gesture = gestureRef.current
      if (gesture === null || event.pointerId !== gesture.id) return
      gesture.x = event.clientX
      gesture.y = event.clientY
      if (!gesture.decided) {
        if (
          Math.abs(gesture.x - gesture.x0) < AXIS_THRESHOLD &&
          Math.abs(gesture.y - gesture.y0) < AXIS_THRESHOLD
        ) {
          return
        }
        gesture.decided = true
        if (Math.abs(gesture.x - gesture.x0) > Math.abs(gesture.y - gesture.y0)) {
          gesture.marquee = true
          suppressClick.current = true
          lastKeys.current = "\u0000"
          try {
            scroll.setPointerCapture(gesture.id)
          } catch {
            // jsdom / a detached node — the gesture still tracks via bubbling.
          }
        } else {
          // Vertical: let the browser pan the container instead.
          gestureRef.current = null
        }
        schedule()
        return
      }
      if (gesture.marquee) schedule()
    }

    const onPointerUp = (event: PointerEvent) => {
      const gesture = gestureRef.current
      if (gesture === null || event.pointerId !== gesture.id) return
      stop()
      gestureRef.current = null
      suppressClick.current = gesture.marquee
      setOverlay(null)
    }

    // The marquee's pointerup still emits a click on whatever card it ended
    // over; a capture-phase guard swallows it before React's root listener sees it.
    const onClickCapture = (event: MouseEvent) => {
      if (!suppressClick.current) return
      suppressClick.current = false
      event.preventDefault()
      event.stopPropagation()
    }

    const onScrollDuringGesture = () => {
      if (gestureRef.current?.marquee === true) schedule()
    }

    scroll.addEventListener("pointerdown", onPointerDown)
    scroll.addEventListener("pointermove", onPointerMove)
    scroll.addEventListener("pointerup", onPointerUp)
    scroll.addEventListener("pointercancel", onPointerUp)
    scroll.addEventListener("click", onClickCapture, true)
    scroll.addEventListener("scroll", onScrollDuringGesture, { passive: true })
    return () => {
      stop()
      scroll.removeEventListener("pointerdown", onPointerDown)
      scroll.removeEventListener("pointermove", onPointerMove)
      scroll.removeEventListener("pointerup", onPointerUp)
      scroll.removeEventListener("pointercancel", onPointerUp)
      scroll.removeEventListener("click", onClickCapture, true)
      scroll.removeEventListener("scroll", onScrollDuringGesture)
    }
  }, [scrollRef, tick])

  return { overlay }
}
