/**
 * Todo 25 (spec L508): the web-side half of the keyboard contract. Capacitor's
 * `Keyboard` fires `keyboardWillShow`/`keyboardWillHide`; this seam parses the
 * reported height into `--keyboard-inset` and scrolls the focused field into
 * view after the inset changes. The real native bridge is todo 29's; these
 * tests drive the same events the bridge will dispatch.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  KEYBOARD_HIDE_EVENT,
  KEYBOARD_INSET_VAR,
  KEYBOARD_SHOW_EVENT,
  applyKeyboardInset,
  getKeyboardInset,
  installKeyboardBridge,
  parseKeyboardInset,
  scrollFocusedFieldIntoView,
  setKeyboardInset,
  subscribeToKeyboardInset,
} from "@/lib/keyboard-inset"

/** jsdom does not implement scrollIntoView; every test installs its own spy. */
function spyOnScrollIntoView(element: HTMLElement): ReturnType<typeof vi.fn> {
  const spy = vi.fn()
  element.scrollIntoView = spy as unknown as HTMLElement["scrollIntoView"]
  return spy
}

function stubReducedMotion(reduce: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
  }))
}

afterEach(() => {
  setKeyboardInset(0)
  document.documentElement.removeAttribute("style")
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe("parseKeyboardInset", () => {
  it("reads the Capacitor keyboardHeight detail", () => {
    expect(parseKeyboardInset({ keyboardHeight: 291 })).toBe(291)
  })

  it("rounds fractional heights to whole pixels", () => {
    expect(parseKeyboardInset({ keyboardHeight: 291.6 })).toBe(292)
  })

  it("treats a missing or malformed detail as zero", () => {
    expect(parseKeyboardInset({})).toBe(0)
    expect(parseKeyboardInset(undefined)).toBe(0)
    expect(parseKeyboardInset(null)).toBe(0)
    expect(parseKeyboardInset({ keyboardHeight: "300" })).toBe(0)
    expect(parseKeyboardInset({ keyboardHeight: Number.NaN })).toBe(0)
  })

  it("clamps negative heights to zero", () => {
    expect(parseKeyboardInset({ keyboardHeight: -12 })).toBe(0)
  })
})

describe("applyKeyboardInset", () => {
  it("writes the pixel value to the --keyboard-inset custom property", () => {
    applyKeyboardInset(document.documentElement, 320)
    expect(document.documentElement.style.getPropertyValue(KEYBOARD_INSET_VAR)).toBe("320px")
  })

  it("never writes a negative inset", () => {
    applyKeyboardInset(document.documentElement, -5)
    expect(document.documentElement.style.getPropertyValue(KEYBOARD_INSET_VAR)).toBe("0px")
  })
})

describe("installKeyboardBridge", () => {
  it("tracks keyboardWillShow and keyboardWillHide into the store and the CSS var", () => {
    const seen: number[] = []
    const unsubscribe = subscribeToKeyboardInset((inset) => seen.push(inset))
    const bridge = installKeyboardBridge(window, document)

    window.dispatchEvent(
      new CustomEvent(KEYBOARD_SHOW_EVENT, { detail: { keyboardHeight: 336 } }),
    )
    expect(getKeyboardInset()).toBe(336)
    expect(document.documentElement.style.getPropertyValue(KEYBOARD_INSET_VAR)).toBe("336px")

    window.dispatchEvent(new CustomEvent(KEYBOARD_HIDE_EVENT, { detail: {} }))
    expect(getKeyboardInset()).toBe(0)
    expect(document.documentElement.style.getPropertyValue(KEYBOARD_INSET_VAR)).toBe("0px")
    expect(seen).toEqual([336, 0])

    bridge()
    unsubscribe()
    window.dispatchEvent(
      new CustomEvent(KEYBOARD_SHOW_EVENT, { detail: { keyboardHeight: 100 } }),
    )
    expect(getKeyboardInset()).toBe(0)
  })

  it("notifies subscribers only when the inset actually changes", () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToKeyboardInset(listener)
    const bridge = installKeyboardBridge(window, document)

    window.dispatchEvent(
      new CustomEvent(KEYBOARD_SHOW_EVENT, { detail: { keyboardHeight: 300 } }),
    )
    window.dispatchEvent(
      new CustomEvent(KEYBOARD_SHOW_EVENT, { detail: { keyboardHeight: 300 } }),
    )
    expect(listener).toHaveBeenCalledTimes(1)

    bridge()
    unsubscribe()
  })
})

describe("scrollFocusedFieldIntoView", () => {
  it("scrolls the focused input into view with smooth motion by default", () => {
    stubReducedMotion(false)
    const input = document.createElement("input")
    document.body.append(input)
    input.focus()
    const spy = spyOnScrollIntoView(input)

    expect(scrollFocusedFieldIntoView(document)).toBe(true)
    expect(spy).toHaveBeenCalledWith({ block: "center", behavior: "smooth" })
  })

  it("uses instant scrolling when the user prefers reduced motion", () => {
    stubReducedMotion(true)
    const input = document.createElement("textarea")
    document.body.append(input)
    input.focus()
    const spy = spyOnScrollIntoView(input)

    expect(scrollFocusedFieldIntoView(document)).toBe(true)
    expect(spy).toHaveBeenCalledWith({ block: "center", behavior: "auto" })
  })

  it("does nothing when focus is not on a field", () => {
    const div = document.createElement("div")
    document.body.append(div)
    div.focus()

    expect(scrollFocusedFieldIntoView(document)).toBe(false)
  })
})
