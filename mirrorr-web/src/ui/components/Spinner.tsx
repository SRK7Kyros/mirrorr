import { cn } from "@/ui/lib/cn"

/**
 * Indeterminate spinner. The `spin` keyframes live in `components.css`; every
 * border colour is side-specific so the accent top never races the ring colour.
 */
export function Spinner({ className }: { readonly className?: string }) {
  return (
    <span
      className={cn(
        "size-4 shrink-0 rounded-full border-2 border-x-line-strong border-b-line-strong border-t-brand animate-[spin_0.7s_linear_infinite]",
        className,
      )}
      role="status"
      aria-label="Loading"
    />
  )
}