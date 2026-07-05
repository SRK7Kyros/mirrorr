/**
 * Atomic drag handle for resizing CSS grid cells.
 *
 * Place inside a `position: relative` container at the trailing edge.
 * Uses absolute positioning — on drag start it captures the initial value
 * and cursor position, then computes the clamped result each frame.
 *
 * Usage:
 *   <DragHandle direction="vertical" value={width} min={200} max={600} onChange={setWidth} />
 */
import { useRef } from "react"
import { cn } from "@/lib/utils"

export interface DragHandleProps {
  direction: "vertical" | "horizontal"
  value: number
  min?: number
  max?: number
  onChange: (value: number) => void
  className?: string
}

export function DragHandle({ direction, value, min = -Infinity, max = Infinity, onChange, className }: DragHandleProps) {
  const ref = useRef<HTMLDivElement>(null)

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const axis = direction === "vertical" ? "x" : "y"
    const startPos = axis === "x" ? e.clientX : e.clientY
    const startValue = value

    const onMove = (ev: MouseEvent) => {
      const pos = axis === "x" ? ev.clientX : ev.clientY
      const next = Math.max(min, Math.min(max, startValue + (pos - startPos)))
      onChange(next)
    }

    const onUp = () => {
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }

    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
    document.body.style.cursor = direction === "vertical" ? "ew-resize" : "ns-resize"
    document.body.style.userSelect = "none"
  }

  const isVertical = direction === "vertical"

  return (
    <div
      ref={ref}
      className={cn("absolute z-10 group/drag-handle", className)}
      style={
        isVertical
          ? { right: -7, top: "50%", transform: "translateY(-50%)", width: 14, height: 32, cursor: "ew-resize" }
          : { bottom: -7, left: "50%", transform: "translateX(-50%)", height: 14, width: 32, cursor: "ns-resize" }
      }
      onMouseDown={onMouseDown}
    >
      <div
        className={cn(
          "absolute rounded-full bg-border/50 transition-colors opacity-0 group-hover:opacity-100 group-hover:bg-primary/50",
          isVertical
            ? "left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 w-[3px] h-8"
            : "top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 h-[3px] w-8",
        )}
      />
    </div>
  )
}
