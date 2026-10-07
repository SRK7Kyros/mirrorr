import { useEffect, useRef, useState } from "react"
import { copyText } from "@/ui/lib/clipboard"
import { cn } from "@/ui/lib/cn"
import { truncate } from "@/ui/lib/format"
import { IconCheck, IconCopy } from "./icons"
import { toast } from "./Toast"

export interface HashProps {
  /** The full value copied on click — never truncated. */
  readonly value: string
  /** Visible characters before the ellipsis (default 12). */
  readonly chars?: number
  /** Human name for the value, used in the toast and the accessible label. */
  readonly label?: string
  readonly className?: string
}

/**
 * Inline copyable identifier. A mono, ellipsised value that copies on click:
 * the copy glyph fades in on hover/focus, a tick plus the accent hue confirms
 * the copy, and a toast names what was copied.
 */
export function Hash({ value, chars = 12, label = "Value", className }: HashProps) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )

  const copy = async (): Promise<void> => {
    try {
      await copyText(value)
      setCopied(true)
      toast.success("Copied", label)
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1600)
    } catch {
      toast.error("Could not copy", "Clipboard access was denied.")
    }
  }

  return (
    <button
      type="button"
      className={cn("hash", className)}
      data-copied={copied}
      title={`${value} — click to copy`}
      aria-label={`Copy ${label}`}
      onClick={() => void copy()}
    >
      <code className="hash-text">{truncate(value, chars)}</code>
      <span className="hash-icon" aria-hidden="true">
        {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
      </span>
    </button>
  )
}
