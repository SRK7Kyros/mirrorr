import { cn } from "@/ui/lib/cn"
import { initials } from "@/ui/lib/format"

export interface AvatarProps {
  readonly name: string
  readonly small?: boolean
  readonly className?: string
}

/** Monogram avatar — `.avatar` / `.avatar-sm`. */
export function Avatar({ name, small = false, className }: AvatarProps) {
  return (
    <span className={cn("avatar", small && "avatar-sm", className)} aria-hidden="true">
      {initials(name)}
    </span>
  )
}
