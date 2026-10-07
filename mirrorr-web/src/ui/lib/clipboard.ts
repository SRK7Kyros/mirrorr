/**
 * Copy text to the clipboard. Prefers the async Clipboard API and falls back to
 * a hidden textarea + `document.execCommand` for non-secure contexts, where
 * `navigator.clipboard` is undefined.
 */
export async function copyText(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard !== undefined) {
    await navigator.clipboard.writeText(text)
    return
  }

  const area = document.createElement("textarea")
  area.value = text
  area.setAttribute("readonly", "")
  area.style.position = "fixed"
  area.style.top = "-1000px"
  area.style.opacity = "0"
  document.body.appendChild(area)
  area.select()
  const ok = document.execCommand("copy")
  area.remove()
  if (!ok) throw new Error("Clipboard write failed")
}
