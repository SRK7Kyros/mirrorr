/**
 * Object-URL download seam — spec L546/L614: an authenticated export result is
 * handed to the browser as a `.json` download; when the environment cannot
 * produce one (WebView without a download manager) the seam reports `false` so
 * the caller can offer "Export ready — copy the JSON" instead of losing the
 * payload.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { downloadJson } from "@/lib/download"

const JSON_TEXT = '{"version":1,"profiles":[],"autoruns":[]}'

function stubObjectUrls() {
  const create = vi.fn((_blob: Blob) => "blob:mirrorr-export")
  const revoke = vi.fn((_url: string) => undefined)
  Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: create })
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: revoke })
  return { create, revoke }
}

function captureClicks() {
  const anchors: HTMLAnchorElement[] = []
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function (this: HTMLAnchorElement) {
      anchors.push(this)
    })
  return { click, anchors }
}

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(URL, "createObjectURL")
  Reflect.deleteProperty(URL, "revokeObjectURL")
})

describe("downloadJson", () => {
  it("builds an application/json blob, clicks a download anchor, and revokes the object URL", async () => {
    const { create, revoke } = stubObjectUrls()
    const { click, anchors } = captureClicks()

    const started = downloadJson("profile-9.json", JSON_TEXT)

    expect(started).toBe(true)
    expect(click).toHaveBeenCalledTimes(1)
    expect(anchors[0]?.download).toBe("profile-9.json")
    expect(anchors[0]?.href).toBe("blob:mirrorr-export")

    const blob = create.mock.calls[0]?.[0]
    expect(blob).toBeInstanceOf(Blob)
    expect(blob?.type).toBe("application/json")
    await expect(blob?.text()).resolves.toBe(JSON_TEXT)

    expect(revoke).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledWith("blob:mirrorr-export")
  })

  it("returns false without touching the DOM when object URLs are unavailable", () => {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: undefined })
    const { click } = captureClicks()

    expect(downloadJson("profile-9.json", JSON_TEXT)).toBe(false)
    expect(click).not.toHaveBeenCalled()
  })

  it("returns false without touching the DOM when the object URL cannot be created", () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error("object URLs are not supported here")
      },
    })
    const { click } = captureClicks()

    expect(downloadJson("profile-9.json", JSON_TEXT)).toBe(false)
    expect(click).not.toHaveBeenCalled()
  })

  it("returns false when the environment has no anchor download support", () => {
    stubObjectUrls()
    const descriptor = Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, "download")
    Reflect.deleteProperty(HTMLAnchorElement.prototype, "download")

    try {
      expect(downloadJson("profile-9.json", JSON_TEXT)).toBe(false)
    } finally {
      if (descriptor !== undefined) Object.defineProperty(HTMLAnchorElement.prototype, "download", descriptor)
    }
  })
})
