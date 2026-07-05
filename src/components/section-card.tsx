/**
 * Reusable card with a header bar and content area.
 * Replaces the 9× repeated pattern:
 *   <div className="border rounded-lg overflow-hidden">
 *     <div className="px-4 py-2.5 border-b bg-muted/20 flex items-center justify-between">
 *       <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Title</h3>
 *       {actions}
 *     </div>
 *     {children}
 *   </div>
 */
import { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface SectionCardProps {
  title: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}

export function SectionCard({ title, actions, children, className }: SectionCardProps) {
  return (
    <div className={cn("border rounded-lg overflow-hidden", className)}>
      <div className="px-4 py-2.5 border-b bg-muted/20 flex items-center justify-between">
        {typeof title === "string" ? (
          <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{title}</h3>
        ) : title}
        {actions}
      </div>
      {children}
    </div>
  )
}
