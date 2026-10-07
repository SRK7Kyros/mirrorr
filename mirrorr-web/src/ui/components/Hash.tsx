import { useEffect, useRef, useState } from "react"
import { copyText } from "@/ui/lib/clipboard"
import { cn } from "@/ui/lib/cn"
import { IconCheck, IconCopy } from "./icons"
import { toast } from "./Toast"

export interface HashProps {
  /** The full value — copied on click, ellipsised by CSS to the space available. */
  readonly value: string
  /** Human name for the value, used in the toast and the accessible label. */
  readonly label?: string
  readonly className?: string
}

/**
 * Inline copyable identifier. The mono value fills whatever width it is given
 * and ellipsises to fit; clicking copies it, the copy glyph fades in on
 * hover/focus, a tick plus the accent hue confirms the copy, and a toast names
 * what was copied.
 */
export function Hash({ value, label = "Value", className }: HashProps) {
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
      <code className="hash-text">{value}</code>
      <span className="hash-icon" aria-hidden="true">
        {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
      </span>
    </button>
  )
}
