import { cn } from "@/lib/utils"
import { RefreshCw } from "lucide-react"

interface SyncIndicatorProps {
  syncing: boolean
  className?: string
}

export function SyncIndicator({ syncing, className }: SyncIndicatorProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 transition-opacity",
        syncing ? "opacity-100" : "opacity-0 pointer-events-none",
        className
      )}
    >
      <RefreshCw className={cn("size-3 text-blue-500", syncing && "animate-spin")} />
      <span className="text-2xs text-blue-500 font-medium">Syncing</span>
    </div>
  )
}
