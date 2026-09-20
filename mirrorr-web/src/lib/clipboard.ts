/**
 * Clipboard access for the copy buttons (V9 origin hashes, V7 copy link).
 * Returns `false` instead of throwing when the async Clipboard API is
 * unavailable or denied, so the caller decides the failure copy.
 *
 * A Capacitor WebView can lack the async Clipboard API entirely (it requires a
 * secure context), so the wrapper registers the platform plugin as the fallback
 * writer (spec L613).
 */
type ClipboardWriter = (text: string) => Promise<void>

let nativeWriter: ClipboardWriter | null = null

export function setClipboardWriter(writer: ClipboardWriter | null): void {
  nativeWriter = writer
}

export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator.clipboard?.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Denied here, but the wrapper's writer may still succeed.
    }
  }
  if (nativeWriter === null) return false
  try {
    await nativeWriter(text)
    return true
  } catch {
    return false
  }
}
