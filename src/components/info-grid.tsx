import { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface InfoField {
  label: string
  value: ReactNode
}

interface InfoGridProps {
  fields: InfoField[]
  className?: string
}

export function InfoGrid({ fields, className }: InfoGridProps) {
  return (
    <div
      className={cn("grid gap-x-4 gap-y-1 justify-items-start w-fit", className)}
      style={{ gridTemplateRows: "auto auto", gridAutoFlow: "column", gridAutoColumns: "auto" }}
    >
      {fields.map((f) => (
        <div
          key={f.label}
          className="grid gap-y-px"
          style={{ gridRow: "span 2", gridTemplateRows: "subgrid" }}
        >
          <span className="text-[11px] text-muted-foreground">{f.label}</span>
          <span className="text-xs">{f.value}</span>
        </div>
      ))}
    </div>
  )
}
