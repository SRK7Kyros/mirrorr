/**
 * Reusable form field wrapper — label + input/select + optional error.
 * Replaces the 17× repeated pattern:
 *   <div className="space-y-1.5">
 *     <Label className="text-[11px]">Label</Label>
 *     <Input className="h-8 text-xs" ... />
 *     {error && <p className="text-[11px] text-destructive">{error}</p>}
 *   </div>
 */
import { ReactNode } from "react"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

interface FormFieldProps {
  label: string
  error?: string
  children: ReactNode
  className?: string
}

export function FormField({ label, error, children, className }: FormFieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-[11px]">{label}</Label>
      {children}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  )
}
