/**
 * Safe-area insets, kept current in `--safe-top/right/bottom/left`.
 *
 * Reading them once is not enough, for two separate reasons.
 *
 * A WKWebView answers `env(safe-area-inset-*)` with zeros until shortly after
 * it has been initialised — on first launch *and* again on every return from
 * suspension (WebKit bug 191872) — so a single read at start-up records a phone
 * with no notch and the status bar keeps the top bar. The reading is therefore
 * re-taken a few times over the next couple of seconds, and again whenever the
 * page is shown after being hidden.
 *
 * A turned WebView can also keep answering with the orientation it just left,
 * so a portrait screen comes back carrying the landscape notch on one side and
 * no top inset at all. A notch's thickness does not depend on the orientation,
 * so the value can be moved to the edge the current orientation needs.
 *
 * The native shell may also publish the insets itself (Capacitor's Android
 * `SystemBars` injects `--safe-area-inset-*`, which is what to trust where
 * `env()` is still wrong — Android WebView below 140). Those win when present.
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

/** How long the engine may take to publish real insets after it starts or
 *  resumes. The last few reads are cheap (one throwaway element each) and are
 *  what turns a zero from a cold WebView into the phone's real notch. */
const SETTLE_DELAYS_MS = [60, 180, 400, 800, 1600, 2400]

function toPixels(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? "")
  return Number.isFinite(parsed) ? parsed : 0
}

function sum(insets: SafeAreaInsets): number {
  return insets.top + insets.right + insets.bottom + insets.left
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
 * The insets the native shell published on `<html>`, if any. Capacitor's
 * Android `SystemBars` writes `--safe-area-inset-*` because `env()` is still
 * wrong there on older WebViews; a browser has neither variable and both
 * readings are zero.
 */
export function readNativeInsets(doc: Document): SafeAreaInsets {
  const style = doc.defaultView?.getComputedStyle(doc.documentElement)
  const read = (name: string): number =>
    toPixels(style?.getPropertyValue(name))
  return {
    top: read("--safe-area-inset-top"),
    right: read("--safe-area-inset-right"),
    bottom: read("--safe-area-inset-bottom"),
    left: read("--safe-area-inset-left"),
  }
}

/** The phone's insets: the shell's own reading when it has one, else the
 *  engine's. */
export function readInsets(doc: Document): SafeAreaInsets {
  const native = readNativeInsets(doc)
  if (sum(native) > 0) return native
  return readEnvInsets(doc)
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

function sameInsets(a: SafeAreaInsets, b: SafeAreaInsets): boolean {
  return (
    a.top === b.top &&
    a.right === b.right &&
    a.bottom === b.bottom &&
    a.left === b.left
  )
}

/** Write the insets now, again while a cold or resumed WebView settles, and
 *  after every rotation, resize and return to the page. Returns the disposer. */
export function installSafeArea(doc: Document, win: Window): () => void {
  const root = doc.documentElement
  let last: SafeAreaInsets | null = null
  let settleTimers: number[] = []
  let disposed = false

  const update = (): void => {
    if (disposed) return
    const insets = normalizeInsets(
      readInsets(doc),
      win.innerHeight >= win.innerWidth,
      win.innerWidth,
    )
    if (last !== null && sameInsets(last, insets)) return
    last = insets
    applyInsets(root, insets)
  }

  const later = (): void => {
    update()
    win.requestAnimationFrame(update)
  }

  const settle = (): void => {
    for (const timer of settleTimers) win.clearTimeout(timer)
    settleTimers = SETTLE_DELAYS_MS.map((delay) => win.setTimeout(update, delay))
    update()
  }

  const resume = (): void => {
    if (doc.visibilityState === "hidden") return
    later()
    settle()
  }

  settle()

  win.addEventListener("resize", later)
  win.addEventListener("orientationchange", later)
  win.addEventListener("pageshow", resume)
  win.addEventListener("focus", resume)
  doc.addEventListener("visibilitychange", resume)
  win.visualViewport?.addEventListener("resize", later)

  return () => {
    disposed = true
    for (const timer of settleTimers) win.clearTimeout(timer)
    settleTimers = []
    win.removeEventListener("resize", later)
    win.removeEventListener("orientationchange", later)
    win.removeEventListener("pageshow", resume)
    win.removeEventListener("focus", resume)
    doc.removeEventListener("visibilitychange", resume)
    win.visualViewport?.removeEventListener("resize", later)
  }
}
