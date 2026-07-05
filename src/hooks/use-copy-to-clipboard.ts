/**
 * Copy text to clipboard with visual feedback.
 * Returns [copied, copyToClipboard].
 *
 * Usage:
 *   const [copied, copy] = useCopyToClipboard()
 *   <Button onClick={() => copy("text to copy")}>
 *     {copied ? "Copied!" : "Copy"}
 *   </Button>
 */
import { useState, useCallback, useRef } from "react"

export function useCopyToClipboard(timeout = 1500) {
  const [copied, setCopied] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>()

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => setCopied(false), timeout)
    } catch {
      // Clipboard API may fail in some contexts (e.g., non-HTTPS)
    }
  }, [timeout])

  return [copied, copy] as const
}
