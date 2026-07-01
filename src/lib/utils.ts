import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Parse a naive UTC datetime string from the backend into a local Date.
 *  Appends "Z" if the string has no timezone info so JS treats it as UTC. */
export function parseUtcDate(value: string | null | undefined): Date | null {
  if (!value) return null
  // Already has timezone info — let Date handle it
  if (value.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(value)) return new Date(value)
  // Naive UTC — append Z so JS interprets as UTC then displays in local time
  return new Date(value + "Z")
}

/** Format a naive UTC datetime string to a locale-aware local-time string. */
export function formatLocalDate(value: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  const d = parseUtcDate(value)
  if (!d) return "—"
  return d.toLocaleString(undefined, opts ?? { hour12: false })
}

export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}

export function formatDuration(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60

  // Show decimals only when the value is below the first display threshold (6s)
  const showDecimals = seconds < 6
  const sFmt = showDecimals ? Math.round(s * 10) / 10 : Math.floor(s)

  if (d > 0) return `${d}d ${h}h ${m}m ${Math.floor(s)}s`
  if (h > 0) return `${h}h ${m}m ${Math.floor(s)}s`
  if (seconds >= 6) return `${m}m ${sFmt}s`
  return `${sFmt}s`
}
