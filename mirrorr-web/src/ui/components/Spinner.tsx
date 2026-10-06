import { cn } from "@/ui/lib/cn"

/** Indeterminate spinner — `.spinner` from components.css. */
export function Spinner({ className }: { readonly className?: string }) {
  return <span className={cn("spinner", className)} role="status" aria-label="Loading" />
}
