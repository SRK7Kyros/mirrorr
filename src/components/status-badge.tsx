import { cn } from "@/lib/utils"

const statusStyle: Record<string, { bg: string; text: string; label: string }> = {
  scheduled:   { bg: "bg-sky-500/15",    text: "text-sky-600 dark:text-sky-400",       label: "Scheduled" },
  active:      { bg: "bg-emerald-500/15", text: "text-emerald-600 dark:text-emerald-400", label: "Active" },
  running:     { bg: "bg-emerald-500/15", text: "text-emerald-600 dark:text-emerald-400", label: "Running" },
  recording:   { bg: "bg-amber-500/15",   text: "text-amber-600 dark:text-amber-400",   label: "Recording" },
  terminating: { bg: "bg-orange-500/15",  text: "text-orange-600 dark:text-orange-400", label: "Terminating" },
  remuxing:    { bg: "bg-blue-500/15",    text: "text-blue-600 dark:text-blue-400",     label: "Remuxing" },
  deleting:    { bg: "bg-violet-500/15",  text: "text-violet-600 dark:text-violet-400", label: "Deleting" },
  completed:   { bg: "bg-blue-500/15",    text: "text-blue-600 dark:text-blue-400",     label: "Completed" },
  failed:      { bg: "bg-red-500/15",     text: "text-red-600 dark:text-red-400",       label: "Failed" },
}

const dotColor: Record<string, string> = {
  scheduled: "bg-sky-500", active: "bg-emerald-500", running: "bg-emerald-500",
  recording: "bg-amber-500", terminating: "bg-orange-500", remuxing: "bg-blue-500",
  deleting: "bg-violet-500", completed: "bg-blue-500", failed: "bg-red-500",
}

export function StatusBadge({ status }: { status: string }) {
  const style = statusStyle[status] ?? { bg: "bg-muted", text: "text-muted-foreground", label: status }
  const dot = dotColor[status] ?? "bg-muted-foreground/30"
  return (
    <span
      role="status"
      aria-label={`Status: ${style.label}`}
      className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold", style.bg, style.text)}
    >
      <span className={cn("size-1.5 rounded-full", dot)} aria-hidden="true" />
      {style.label}
    </span>
  )
}
