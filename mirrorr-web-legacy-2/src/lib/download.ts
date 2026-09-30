/**
 * Object-URL download seam (spec L546/L614).
 *
 * An authenticated export response is handed to the browser as a `.json`
 * download: a Blob → `URL.createObjectURL` → anchor click → revoke. The
 * function reports `false` — never throws — when the environment cannot start
 * a download (`createObjectURL` missing, the anchor lacks `download`, or the
 * object URL cannot be created — some WebViews) so the caller keeps the
 * payload and offers the "Export ready — copy the JSON" fallback instead of
 * losing it.
 */
export function downloadJson(filename: string, json: string): boolean {
  if (typeof URL.createObjectURL !== "function" || typeof URL.revokeObjectURL !== "function") return false

  const anchor = document.createElement("a")
  if (!("download" in anchor)) return false

  let objectUrl: string | undefined
  try {
    objectUrl = URL.createObjectURL(new Blob([json], { type: "application/json" }))
    anchor.href = objectUrl
    anchor.download = filename
    anchor.rel = "noopener"
    anchor.click()
    return true
  } catch {
    return false
  } finally {
    if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl)
  }
}
