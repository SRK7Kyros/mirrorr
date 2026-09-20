/**
 * Clipboard access for the copy buttons (V9 origin hashes, V7 copy link).
 * Returns `false` instead of throwing when the async Clipboard API is
 * unavailable or denied, so the caller decides the failure copy.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator.clipboard?.writeText !== "function") return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
