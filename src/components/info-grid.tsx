import { ReactNode } from "react"
import { StatusBadge } from "@/components/status-badge"
import { cn } from "@/lib/utils"

interface InfoField {
  label: string
  value: ReactNode
}

interface InfoGridProps {
  fields: InfoField[]
  columns?: number
  className?: string
}

export function InfoGrid({ fields, columns = 5, className }: InfoGridProps) {
  return (
    <div
      className={cn("grid gap-x-4 gap-y-1 justify-items-start w-fit", className)}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(4.5rem, auto))` }}
    >
      {fields.map((f) => (
        <span key={f.label} className="text-[11px] text-muted-foreground">{f.label}</span>
      ))}
      {fields.map((f) => (
        <span key={f.label} className="text-xs">{f.value}</span>
      ))}
    </div>
  )
}

export function StatusField({ status }: { status: string }) {
  return <StatusBadge status={status} />
}
