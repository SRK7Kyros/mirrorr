/**
 * Per-row export control — spec L331/L546/L614, contract §9/§13.5.
 *
 * Success: authenticated fetch → Blob → object-URL download named by kind/id.
 * Fallback: when the browser cannot start a download, the payload stays
 * available in the "Export ready — copy the JSON" dialog and `copyText` copies
 * it. Failures surface `userMessageForError`, never a silent or raw error.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ExportBundleButton } from "@/components/import-export/ExportBundleButton"
import { ToastViewport } from "@/components/ui/Toast"
import { API_URL_ENV_VAR } from "@/config/env"
import { clearToasts, getToasts } from "@/lib/toast"
import { installFetch, jsonResponse } from "@/test/api-helpers"

const BUNDLE = {
  version: 1,
  exported_at: "2026-09-20T12:00:00",
  profiles: [
    {
      name: "p2",
      default_engine: { name: "yt_dlp_piped", origin_hash: "6e57" },
      resolver: { name: "static", origin_hash: "f1c2" },
      resolver_config: { url: "https://example.com/a.m3u8" },
      retry_mode: "none",
      retry_config: {},
    },
  ],
  autoruns: [],
}
const BUNDLE_TEXT = JSON.stringify(BUNDLE)
const FALLBACK_TITLE = "Export ready — copy the JSON"

function renderButton(kind: "profile" | "autorun", id: number, name: string) {
  render(
    <>
      <ExportBundleButton kind={kind} id={id} name={name} />
      <ToastViewport />
    </>,
  )
}

function stubObjectUrls() {
  const create = vi.fn((_blob: Blob) => "blob:mirrorr-export")
  const revoke = vi.fn((_url: string) => undefined)
  Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: create })
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: revoke })
  return { create, revoke }
}

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
}

function stubNoDownload() {
  Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: undefined })
}

async function openFallback(name: string): Promise<HTMLTextAreaElement> {
  fireEvent.click(screen.getByRole("button", { name: `Export ${name}` }))
  await screen.findByRole("dialog", { name: FALLBACK_TITLE })
  return screen.getByTestId("export-fallback-json") as HTMLTextAreaElement
}

beforeEach(() => {
  vi.stubEnv(API_URL_ENV_VAR, "/api")
  clearToasts()
})

afterEach(() => {
  Reflect.deleteProperty(URL, "createObjectURL")
  Reflect.deleteProperty(URL, "revokeObjectURL")
  Reflect.deleteProperty(navigator, "clipboard")
})

describe("ExportBundleButton download", () => {
  it("downloads a profile bundle through the authenticated endpoint", async () => {
    const fetchMock = installFetch(async () => jsonResponse(200, BUNDLE))
    const { create, revoke } = stubObjectUrls()
    renderButton("profile", 9, "p2")

    fireEvent.click(screen.getByRole("button", { name: "Export p2" }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/import-export/profiles/9/export")
    const blob = create.mock.calls[0]?.[0]
    await expect(blob?.text()).resolves.toBe(BUNDLE_TEXT)
    expect(revoke).toHaveBeenCalledWith("blob:mirrorr-export")
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.queryByText(FALLBACK_TITLE)).toBeNull()
  })

  it("downloads an autorun bundle and names the file from the row id", async () => {
    const fetchMock = installFetch(async () => jsonResponse(200, BUNDLE))
    const { create } = stubObjectUrls()
    let suggested = ""
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        suggested = this.download
      })
    renderButton("autorun", 7, "Morning run")

    fireEvent.click(screen.getByRole("button", { name: "Export Morning run" }))

    await waitFor(() => expect(click).toHaveBeenCalledTimes(1))
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/import-export/autoruns/7/export")
    expect(suggested).toBe("autorun-7.json")
    expect(create).toHaveBeenCalledTimes(1)
  })
})

describe("ExportBundleButton fallback", () => {
  it("keeps the payload copyable when the download cannot start", async () => {
    installFetch(async () => jsonResponse(200, BUNDLE))
    stubNoDownload()
    renderButton("profile", 9, "p2")

    const json = await openFallback("p2")

    expect(json.value).toBe(BUNDLE_TEXT)
    expect(json.getAttribute("readonly")).not.toBeNull()
    expect(screen.getByRole("button", { name: "Copy JSON" })).toBeDefined()
  })

  it("copies the fallback JSON and toasts the success", async () => {
    installFetch(async () => jsonResponse(200, BUNDLE))
    stubNoDownload()
    const writeText = vi.fn(async (_text: string) => undefined)
    stubClipboard(writeText)
    renderButton("autorun", 7, "Morning run")

    await openFallback("Morning run")
    fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(BUNDLE_TEXT))
    await waitFor(() => expect(getToasts().some((toast) => toast.message === "JSON copied")).toBe(true))
  })

  it("toasts the failure when the clipboard is denied", async () => {
    installFetch(async () => jsonResponse(200, BUNDLE))
    stubNoDownload()
    stubClipboard(async () => {
      throw new Error("denied")
    })
    renderButton("profile", 9, "p2")

    await openFallback("p2")
    fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }))

    await waitFor(() =>
      expect(getToasts().some((toast) => toast.message === "Could not copy the JSON" && toast.tone === "error")).toBe(
        true,
      ),
    )
  })
})

describe("ExportBundleButton failure and pending states", () => {
  it("toasts the server detail when the export request fails", async () => {
    installFetch(async () => jsonResponse(403, { detail: "Not authorized to export this resource" }))
    renderButton("profile", 9, "p2")

    fireEvent.click(screen.getByRole("button", { name: "Export p2" }))

    await waitFor(() =>
      expect(
        getToasts().some(
          (toast) => toast.message === "Not authorized to export this resource" && toast.tone === "error",
        ),
      ).toBe(true),
    )
    expect(screen.queryByText(FALLBACK_TITLE)).toBeNull()
  })

  it("announces the in-flight export and disables the control", async () => {
    let release: ((response: Response) => void) | undefined
    installFetch(() => new Promise<Response>((resolve) => (release = resolve)))
    stubObjectUrls()
    renderButton("autorun", 7, "Morning run")

    fireEvent.click(screen.getByRole("button", { name: "Export Morning run" }))

    const busy = await screen.findByRole("button", { name: "Exporting Morning run" })
    expect(busy.getAttribute("aria-busy")).toBe("true")
    expect(busy.hasAttribute("disabled")).toBe(true)
    expect(screen.getByTestId("export-status").textContent).toBe("Exporting Morning run…")

    await act(async () => {
      release?.(jsonResponse(200, BUNDLE))
    })
    await waitFor(() => expect(screen.getByRole("button", { name: "Export Morning run" })).toBeDefined())
  })
})
