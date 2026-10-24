/**
 * Safe-area insets, kept current in `--safe-top/right/bottom/left`.
 *
 * `env(safe-area-inset-*)` alone is not reliable on a phone that turns: the
 * WebView can keep answering with the orientation it just left, so a portrait
 * screen comes back carrying the landscape notch on one side and no top inset
 * at all — the status bar then covers the top bar and the content column starts
 * a notch's width in from the edge. A notch's thickness does not depend on the
 * orientation, so the value can be moved to the edge the current orientation
 * needs; the same reading is re-taken on every rotation and written where the
 * stylesheet reads it.
 */

export interface SafeAreaInsets {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

/** An iPad's landscape window is wider than any phone, and it legitimately
 *  carries a top inset in both orientations, so it is left alone. */
const TABLET_WIDTH = 1024

const PROBE_PADDING =
  "env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) " +
  "env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)"

const PROBE_STYLE =
  "position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:"

function toPixels(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? "")
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Read the insets from the engine. The probe is a fresh element every time,
 * because an element styled before the rotation can keep the value it was first
 * given while a newly styled one resolves the current one.
 */
export function readEnvInsets(doc: Document): SafeAreaInsets {
  const probe = doc.createElement("div")
  probe.setAttribute("aria-hidden", "true")
  probe.style.cssText = PROBE_STYLE + PROBE_PADDING
  doc.body.appendChild(probe)
  const style = doc.defaultView?.getComputedStyle(probe)
  const insets: SafeAreaInsets = {
    top: toPixels(style?.paddingTop),
    right: toPixels(style?.paddingRight),
    bottom: toPixels(style?.paddingBottom),
    left: toPixels(style?.paddingLeft),
  }
  probe.remove()
  return insets
}

/**
 * Move a notch inset reported for the previous orientation onto the edge the
 * current one needs. A portrait phone must not be inset at the sides, and a
 * phone's landscape window has no top inset; an iPad is exempt from the
 * landscape rule because its top inset is real in both orientations.
 */
export function normalizeInsets(
  raw: SafeAreaInsets,
  portrait: boolean,
  windowWidth: number,
): SafeAreaInsets {
  const side = Math.max(raw.left, raw.right)
  if (portrait) {
    if (side === 0) return raw
    return { top: Math.max(raw.top, side), right: 0, bottom: raw.bottom, left: 0 }
  }
  if (side > 0 || raw.top === 0 || windowWidth >= TABLET_WIDTH) return raw
  return { top: 0, right: raw.top, bottom: raw.bottom, left: raw.top }
}

export function applyInsets(root: HTMLElement, insets: SafeAreaInsets): void {
  root.style.setProperty("--safe-top", `${insets.top}px`)
  root.style.setProperty("--safe-right", `${insets.right}px`)
  root.style.setProperty("--safe-bottom", `${insets.bottom}px`)
  root.style.setProperty("--safe-left", `${insets.left}px`)
}

/** Write the insets now and after every rotation, resize and back/forward
 *  return. Returns the disposer. */
export function installSafeArea(doc: Document, win: Window): () => void {
  const root = doc.documentElement
  const update = (): void => {
    const insets = normalizeInsets(
      readEnvInsets(doc),
      win.innerHeight >= win.innerWidth,
      win.innerWidth,
    )
    applyInsets(root, insets)
  }

  update()

  const later = (): void => {
    update()
    win.requestAnimationFrame(update)
  }

  win.addEventListener("resize", later)
  win.addEventListener("orientationchange", later)
  win.addEventListener("pageshow", update)
  win.visualViewport?.addEventListener("resize", later)

  return () => {
    win.removeEventListener("resize", later)
    win.removeEventListener("orientationchange", later)
    win.removeEventListener("pageshow", update)
    win.visualViewport?.removeEventListener("resize", later)
  }
}
