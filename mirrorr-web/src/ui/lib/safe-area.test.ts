import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  applyInsets,
  installSafeArea,
  normalizeInsets,
  readEnvInsets,
  readInsets,
  type SafeAreaInsets,
} from "./safe-area"

const NOTCH = 62
const HOME = 34

function insets(overrides: Partial<SafeAreaInsets>): SafeAreaInsets {
  return { top: 0, right: 0, bottom: 0, left: 0, ...overrides }
}

function port(overrides: Partial<SafeAreaInsets>): void {
  const root = document.documentElement
  root.style.setProperty("--safe-area-inset-top", `${overrides.top ?? 0}px`)
  root.style.setProperty("--safe-area-inset-right", `${overrides.right ?? 0}px`)
  root.style.setProperty("--safe-area-inset-bottom", `${overrides.bottom ?? 0}px`)
  root.style.setProperty("--safe-area-inset-left", `${overrides.left ?? 0}px`)
}

function clearPort(): void {
  const style = document.documentElement.style
  for (const name of [
    "--safe-area-inset-top",
    "--safe-area-inset-right",
    "--safe-area-inset-bottom",
    "--safe-area-inset-left",
    "--safe-top",
    "--safe-right",
    "--safe-bottom",
    "--safe-left",
  ]) {
    style.removeProperty(name)
  }
}

function applied(): SafeAreaInsets {
  const style = document.documentElement.style
  const read = (name: string): number =>
    Number.parseFloat(style.getPropertyValue(name) || "0")
  return {
    top: read("--safe-top"),
    right: read("--safe-right"),
    bottom: read("--safe-bottom"),
    left: read("--safe-left"),
  }
}

describe("normalizeInsets", () => {
  it("moves a landscape notch onto a portrait top and off the sides", () => {
    const stale = insets({ left: NOTCH, bottom: 21 })
    expect(normalizeInsets(stale, true, 402)).toEqual({
      top: NOTCH,
      right: 0,
      bottom: 21,
      left: 0,
    })
  })

  it("keeps a correct portrait reading as it is", () => {
    const portrait = insets({ top: NOTCH, bottom: HOME })
    expect(normalizeInsets(portrait, true, 402)).toEqual(portrait)
  })

  it("keeps a correct landscape reading on a phone", () => {
    const landscape = insets({ right: NOTCH, bottom: 21 })
    expect(normalizeInsets(landscape, false, 874)).toEqual(landscape)
  })

  it("moves a portrait top inset onto a phone's landscape sides", () => {
    const stale = insets({ top: NOTCH, bottom: HOME })
    expect(normalizeInsets(stale, false, 874)).toEqual({
      top: 0,
      right: NOTCH,
      bottom: HOME,
      left: NOTCH,
    })
  })

  it("leaves an iPad's landscape top inset alone", () => {
    const tablet = insets({ top: 24, bottom: 20 })
    expect(normalizeInsets(tablet, false, 1024)).toEqual(tablet)
  })

  it("takes the thicker side when both sides carry a notch", () => {
    const both = insets({ left: 62, right: 12 })
    expect(normalizeInsets(both, true, 402).top).toBe(62)
  })
})

describe("applyInsets", () => {
  it("writes every edge onto the root", () => {
    const root = document.documentElement
    applyInsets(root, { top: 59, right: 1, bottom: 34, left: 2 })
    expect(root.style.getPropertyValue("--safe-top")).toBe("59px")
    expect(root.style.getPropertyValue("--safe-right")).toBe("1px")
    expect(root.style.getPropertyValue("--safe-bottom")).toBe("34px")
    expect(root.style.getPropertyValue("--safe-left")).toBe("2px")
  })
})

describe("readEnvInsets", () => {
  it("reads zeros from an engine without safe areas and leaves no probe", () => {
    const before = document.body.children.length
    expect(readEnvInsets(document)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
    expect(document.body.children.length).toBe(before)
  })
})

describe("readInsets", () => {
  afterEach(clearPort)

  it("prefers the insets the native shell published", () => {
    port({ top: 59, bottom: 34 })
    expect(readInsets(document)).toEqual({ top: 59, right: 0, bottom: 34, left: 0 })
  })

  it("falls back to the engine when the shell published nothing", () => {
    expect(readInsets(document)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
  })
})

describe("installSafeArea", () => {
  let dispose: (() => void) | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
      callback()
      return 0
    })
  })

  afterEach(() => {
    dispose?.()
    dispose = null
    clearPort()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("picks the phone's insets up after the WebView has settled", () => {
    dispose = installSafeArea(document, window)
    expect(applied()).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })

    port({ top: 59, bottom: 34 })
    vi.advanceTimersByTime(60)

    expect(applied()).toEqual({ top: 59, right: 0, bottom: 34, left: 0 })
  })

  it("re-reads when the page comes back from suspension", () => {
    dispose = installSafeArea(document, window)
    vi.advanceTimersByTime(2400)
    expect(applied().top).toBe(0)

    port({ top: 59, bottom: 34 })
    document.dispatchEvent(new Event("visibilitychange"))

    expect(applied()).toEqual({ top: 59, right: 0, bottom: 34, left: 0 })
  })

  it("stops writing once it is disposed", () => {
    const uninstall = installSafeArea(document, window)
    uninstall()

    port({ top: 59 })
    vi.advanceTimersByTime(2400)

    expect(applied().top).toBe(0)
  })
})
