import { useRef, useState, type ReactNode } from "react"

export interface TooltipProps {
  readonly label: string
  readonly children: ReactNode
}

/**
 * Lightweight hover/focus tooltip — `.tooltip`, fixed-positioned above the
 * trigger. No portal; the element is small and pointer-events are disabled.
 */
export function Tooltip({ label, children }: TooltipProps) {
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null)
  const ref = useRef<HTMLSpanElement>(null)

  const show = () => {
    const rect = ref.current?.getBoundingClientRect()
    if (rect === undefined) return
    setCoords({ x: rect.left + rect.width / 2, y: rect.top - 8 })
  }

  return (
    <span
      ref={ref}
      style={{ display: "inline-flex" }}
      onMouseEnter={show}
      onMouseLeave={() => setCoords(null)}
      onFocus={show}
      onBlur={() => setCoords(null)}
    >
      {children}
      {coords !== null ? (
        <span
          className="tooltip"
          role="tooltip"
          style={{ left: coords.x, top: coords.y, transform: "translate(-50%, -100%)" }}
        >
          {label}
        </span>
      ) : null}
    </span>
  )
}
