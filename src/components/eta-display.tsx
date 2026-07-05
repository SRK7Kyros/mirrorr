import { useState, useEffect } from "react"
import { useInterval } from "@/hooks/use-interval"
import { cn } from "@/lib/utils"

// ── Time formatting ──────────────────────────────────────────────────

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const ORDINAL = (n: number) => {
  const s = ["th", "st", "nd", "rd"]
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

function formatAbsolute(d: Date) {
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS_LONG[d.getMonth()]} ${ORDINAL(d.getDate())}, ${d.getFullYear()} at ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`
}

function formatRelative(ms: number) {
  if (ms <= 0) return "Now"
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  const months = Math.floor(days / 30)

  const parts: string[] = []
  const rem = { months, days: days % 30, hours: hours % 24, minutes: minutes % 60, seconds: seconds % 60 }
  if (rem.months > 0) parts.push(`${rem.months} month${rem.months !== 1 ? "s" : ""}`)
  if (rem.days > 0) parts.push(`${rem.days} day${rem.days !== 1 ? "s" : ""}`)
  if (rem.hours > 0) parts.push(`${rem.hours} hour${rem.hours !== 1 ? "s" : ""}`)
  if (rem.minutes > 0) parts.push(`${rem.minutes} minute${rem.minutes !== 1 ? "s" : ""}`)
  if (rem.seconds > 0) parts.push(`${rem.seconds} second${rem.seconds !== 1 ? "s" : ""}`)

  if (parts.length === 0) return "Now"
  if (parts.length === 1) return `In ${parts[0]}`
  if (parts.length === 2) return `In ${parts[0]} and ${parts[1]}`
  const last = parts.pop()!
  return `In ${parts.join(", ")} and ${last}`
}

// ── EtaDisplay ───────────────────────────────────────────────────────

interface EtaDisplayProps {
  /** ISO 8601 date string (e.g. "2026-06-22T15:30:00") */
  value: string
  /** "relative" = "In 5 days, 3 hours…", "absolute" = "Friday, June 22nd… at 15:30:45" */
  mode: "relative" | "absolute"
  className?: string
}

export function EtaDisplay({ value, mode, className }: EtaDisplayProps) {
  const [text, setText] = useState("")

  useEffect(() => {
    if (!value) { setText(""); return }

    const tick = () => {
      const target = new Date(value)
      const now = new Date()
      const diff = target.getTime() - now.getTime()

      if (mode === "absolute") {
        setText(formatAbsolute(target))
      } else {
        setText(formatRelative(diff))
      }
    }

    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [value, mode])

  if (!text) return null

  return (
    <p className={cn("text-xs text-muted-foreground italic", className)}>
      {text}
    </p>
  )
}
