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
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}
