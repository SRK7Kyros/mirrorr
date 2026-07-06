/**
 * Reusable inline delete button for sidebar entries.
 * Used in recordings/index.tsx and profiles/index.tsx.
 */
import { Button } from "@/components/ui/button"
import { Trash2, Loader2 } from "lucide-react"

interface InlineDeleteButtonProps {
  id: number
  isPending: boolean
  isActive: boolean
  onClick: (e: React.MouseEvent) => void
}

export function InlineDeleteButton({ id, isPending, isActive, onClick }: InlineDeleteButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className="ml-auto shrink-0 opacity-0 group-hover:opacity-100 hover:text-destructive"
      onClick={onClick}
      disabled={isPending && isActive}
    >
      {isPending && isActive ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
    </Button>
  )
}
