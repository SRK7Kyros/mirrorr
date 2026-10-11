import { cn } from "@/ui/lib/cn"
import { initials } from "@/ui/lib/format"

const AVATAR_BASE =
  "grid place-content-center shrink-0 bg-surface-3 border border-line font-semibold text-ink-muted uppercase"

const AVATAR_SIZE = {
  default: "w-8 h-8 rounded-md text-sm",
  small: "w-[26px] h-[26px] rounded-sm text-xs",
} as const

export interface AvatarProps {
  readonly name: string
  readonly small?: boolean
  readonly className?: string
}

/** Monogram avatar. */
export function Avatar({ name, small = false, className }: AvatarProps) {
  return (
    <span className={cn(AVATAR_BASE, small ? AVATAR_SIZE.small : AVATAR_SIZE.default, className)} aria-hidden="true">
      {initials(name)}
    </span>
  )
}