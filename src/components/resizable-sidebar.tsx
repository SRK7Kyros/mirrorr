/**
 * Reusable two-panel layout with a resizable sidebar.
 * Encapsulates the CSS grid, width state, and DragHandle boilerplate.
 *
 * Usage:
 *   <ResizableSidebar defaultWidth={300} min={200} max={600}>
 *     <SidebarLayout ...> ... </SidebarLayout>
 *     <div className="..."> ... </div>
 *   </ResizableSidebar>
 *
 * First child = sidebar (wrapped in relative group + DragHandle).
 * Second child = detail panel (wrapped in standard container).
 * Any additional children (e.g. dialogs) are rendered outside the grid.
 */
import { useState, type ReactNode } from "react"
import { DragHandle } from "@/components/drag-handle"
import { cn } from "@/lib/utils"
import { AREAS, SIDEBAR_DETAIL } from "@/lib/layouts"

interface ResizableSidebarProps {
  defaultWidth?: number
  min?: number
  max?: number
  /** First two children: [sidebar, detail]. Extra children rendered outside grid. */
  children: ReactNode
  /** Additional classes for the detail panel wrapper. */
  detailClassName?: string
}

export function ResizableSidebar({ defaultWidth = 300, min = 200, max = 600, children, detailClassName }: ResizableSidebarProps) {
  const [width, setWidth] = useState(defaultWidth)
  const childArray = Array.isArray(children) ? children : [children]
  const [sidebar, detail, ...rest] = childArray

  return (
    <>
      <div className="h-full grid gap-2 p-2" style={SIDEBAR_DETAIL.style(width)}>
        <div className="relative group" style={{ gridArea: AREAS.sidebar }}>
          <DragHandle direction="vertical" value={width} min={min} max={max} onChange={setWidth} />
          {sidebar}
        </div>
        <div className={cn("min-h-0 overflow-auto bg-card border rounded-xl", detailClassName)} style={{ gridArea: AREAS.detail }}>
          {detail}
        </div>
      </div>
      {rest}
    </>
  )
}
