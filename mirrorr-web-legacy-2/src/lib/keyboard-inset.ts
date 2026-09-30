/**
 * Todo 25 (spec L508): the web-side half of the keyboard contract.
 *
 * Capacitor's `Keyboard` plugin stays `resize:'none'` (todo 28 owns that line of
 * `capacitor.config.ts`); instead the native side reports
 * `keyboardWillShow`/`keyboardWillHide` and this seam parses the reported height
 * into the `--keyboard-inset` custom property the UI reads. `installKeyboardBridge`
 * is the single install point (`main.tsx`); todo 29 attaches the real Capacitor
 * listener that dispatches the same two events.
 *
 * The store is module-level because the CSS variable is global: the compact
 * scroll container's bottom padding and the dialog height cap resolve
 * `var(--keyboard-inset)`, so no component needs to re-render on a keyboard
 * change — only the focused-field scroll (a hook subscriber) reacts.
 */

/** The spec's variable name (L508). Written on `<html>`; read with `var(..., 0px)`. */
export const KEYBOARD_INSET_VAR = "--keyboard-inset"

/** The Capacitor Keyboard event names, dispatched on `window`. */
export const KEYBOARD_SHOW_EVENT = "keyboardWillShow"
export const KEYBOARD_HIDE_EVENT = "keyboardWillHide"

interface CapacitorKeyboardDetail {
  readonly keyboardHeight?: unknown
}

let currentInset = 0
const listeners = new Set<(inset: number) => void>()

/**
 * Reads the `keyboardHeight` a Capacitor event carries. Anything that is not a
 * finite number — including the string form some bridges produce — is 0, and
 * negative heights cannot produce a negative padding.
 */
export function parseKeyboardInset(detail: unknown): number {
  if (detail === null || typeof detail !== "object") return 0
  const raw = (detail as CapacitorKeyboardDetail).keyboardHeight
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return 0
  return Math.round(raw)
}

/** Writes the inset onto an element's inline style, clamped at 0. */
export function applyKeyboardInset(element: HTMLElement, inset: number): void {
  const safe = Number.isFinite(inset) && inset > 0 ? Math.round(inset) : 0
  element.style.setProperty(KEYBOARD_INSET_VAR, `${safe}px`)
}

export function getKeyboardInset(): number {
  return currentInset
}

/** Applies the inset to the document and notifies subscribers on change only. */
export function setKeyboardInset(inset: number): void {
  const safe = Number.isFinite(inset) && inset > 0 ? Math.round(inset) : 0
  applyKeyboardInset(document.documentElement, safe)
  if (safe === currentInset) return
  currentInset = safe
  for (const listener of listeners) listener(safe)
}

export function subscribeToKeyboardInset(listener: (inset: number) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Listens for the two Capacitor bridge events on `target` and routes them into
 * the store. Returned release is idempotent; nothing about the listener stack is
 * global, so tests can install/uninstall without leaking.
 */
export function installKeyboardBridge(target: Window, doc: Document): () => void {
  const onShow = (event: Event): void => {
    const detail = event instanceof CustomEvent ? event.detail : undefined
    setKeyboardInset(parseKeyboardInset(detail))
  }
  const onHide = (): void => {
    setKeyboardInset(0)
  }

  target.addEventListener(KEYBOARD_SHOW_EVENT, onShow)
  target.addEventListener(KEYBOARD_HIDE_EVENT, onHide)

  return () => {
    target.removeEventListener(KEYBOARD_SHOW_EVENT, onShow)
    target.removeEventListener(KEYBOARD_HIDE_EVENT, onHide)
    doc.documentElement.style.removeProperty(KEYBOARD_INSET_VAR)
  }
}

const FIELD_TAGS: ReadonlySet<string> = new Set(["INPUT", "TEXTAREA", "SELECT"])

/**
 * Spec L508: "the focused field is scrolled into view after the inset changes".
 * Only a focused field counts — a button or body focus is left alone. Motion is
 * instant under reduced motion (the global CSS rule cannot downgrade a JS smooth
 * scroll, so the preference is read here).
 */
export function scrollFocusedFieldIntoView(doc: Document): boolean {
  const active = doc.activeElement
  if (!(active instanceof HTMLElement)) return false
  const tag = active.tagName.toUpperCase()
  const isField = FIELD_TAGS.has(tag) || active.isContentEditable
  if (!isField) return false
  if (typeof active.scrollIntoView !== "function") return false

  const reduce = doc.defaultView?.matchMedia("(prefers-reduced-motion: reduce)").matches ?? false
  active.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" })
  return true
}

/**
 * The single install point (`main.tsx`): bridge events drive the CSS variable
 * and every inset change scrolls the focused field back into view (spec L508).
 * todo 29 keeps the install and swaps the event source for the real Capacitor
 * Keyboard plugin.
 */
export function installKeyboardInset(
  target: Window = window,
  doc: Document = document,
): () => void {
  const releaseBridge = installKeyboardBridge(target, doc)
  const releaseScroll = subscribeToKeyboardInset(() => {
    scrollFocusedFieldIntoView(doc)
  })

  return () => {
    releaseScroll()
    releaseBridge()
  }
}
