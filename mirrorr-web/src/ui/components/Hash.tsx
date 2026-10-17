import { useEffect, useRef, useState } from "react"
import { copyText } from "@/ui/lib/clipboard"
import { cn } from "@/ui/lib/cn"
import { IconCheck, IconCopy } from "./icons"
import { toast } from "./Toast"

const HASH_CLASS =
  "group inline-flex items-center gap-1 max-w-full py-px pl-2 pr-1 border border-transparent rounded-xs bg-surface-2 text-ink-muted cursor-pointer [font-family:var(--font-mono)] text-xs transition-[color,background-color,border-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-surface-3 hover:border-line-subtle hover:text-ink focus-visible:outline-none focus-visible:shadow-[var(--ring)] data-[copied=true]:text-brand data-[copied=true]:bg-brand-dim data-[copied=true]:border-[color:var(--accent-line)]"

const HASH_TEXT_CLASS = "min-w-0 truncate [font:inherit]"

const HASH_ICON_CLASS =
  "inline-flex shrink-0 items-center opacity-0 -translate-x-0.5 transition-[opacity,translate,color] duration-[var(--dur-fast)] ease-[var(--ease-out)] group-hover:opacity-100 group-hover:translate-x-0 group-focus-visible:opacity-100 group-focus-visible:translate-x-0 group-data-[copied=true]:opacity-100 group-data-[copied=true]:translate-x-0 group-data-[copied=true]:text-brand"

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
      className={cn(HASH_CLASS, "tab-stop", className)}
      data-copied={copied}
      title={`${value} — click to copy`}
      aria-label={`Copy ${label}`}
      onClick={() => void copy()}
    >
      <code className={HASH_TEXT_CLASS}>{value}</code>
      <span className={HASH_ICON_CLASS} aria-hidden="true">
        {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
      </span>
    </button>
  )
}
