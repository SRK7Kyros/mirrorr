import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from "react"
import { cn } from "@/ui/lib/cn"

/** Scrollable table shell — `.table-wrap > .table`. */
export function Table({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  return (
    <div className="table-wrap">
      <table className={cn("table", className)}>{children}</table>
    </div>
  )
}

export interface ThProps extends ThHTMLAttributes<HTMLTableCellElement> {
  readonly num?: boolean
}

export function Th({ num = false, className, children, ...rest }: ThProps) {
  return (
    <th scope="col" className={cn(num && "num", className)} {...rest}>
      {children}
    </th>
  )
}

export interface TdProps extends TdHTMLAttributes<HTMLTableCellElement> {
  readonly num?: boolean
  readonly actions?: boolean
}

export function Td({ num = false, actions = false, className, children, ...rest }: TdProps) {
  return (
    <td className={cn(num && "num", actions && "cell-actions", className)} {...rest}>
      {children}
    </td>
  )
}
