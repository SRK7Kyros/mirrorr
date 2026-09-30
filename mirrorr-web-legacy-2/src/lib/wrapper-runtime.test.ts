import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { API_URL_ENV_VAR } from "@/config/env"
import { apiFetch, setAuthTransport } from "@/lib/api"
import { isAppBackgrounded } from "@/lib/app-lifecycle"
import { completeAuthentication, getAuthState } from "@/lib/auth-store"
import { pushBackInterceptor, installBackNavigation } from "@/lib/back-navigation"
import { copyText } from "@/lib/clipboard"
import { installKeyboardInset } from "@/lib/keyboard-inset"
import { authUserSchema } from "@/lib/schemas/auth"
import {
  WRAPPER_TOKEN_KEY_PREFIX,
  parseTokens,
  type SecureTokenStorage,
} from "@/lib/wrapper-session"
import {
  WRAPPER_TOKENS_MISSING_MESSAGE,
  installWrapperRuntime,
  type WrapperPlugins,
} from "@/lib/wrapper-runtime"
import { AUTH_BODY, installFetch, jsonResponse } from "@/test/api-helpers"

const ORIGIN = "https://core.example.com"
const KEY = `${WRAPPER_TOKEN_KEY_PREFIX}${ORIGIN}`
const SEEDED = JSON.stringify({ accessToken: "access-1", refreshToken: "refresh-1" })
const ADMIN_USER = { id: 1, username: "admin", role: "admin", display_name: "Admin" }

function createMemoryStorage(initial: Record<string, string> = {}) {
  const entries = new Map(Object.entries(initial))
  const storage: SecureTokenStorage = {
    async get(key) {
      return entries.get(key) ?? null
    },
    async set(key, value) {
      entries.set(key, value)
    },
    async remove(key) {
      entries.delete(key)
    },
  }
  return { storage, entries }
}

interface PluginRecorder {
  readonly plugins: WrapperPlugins
  readonly listeners: Map<string, (info: unknown) => void>
  readonly order: string[]
  readonly browserOpen: ReturnType<typeof vi.fn>
  readonly clipboardWrite: ReturnType<typeof vi.fn>
}

function createPlugins(storage: SecureTokenStorage, order: string[] = []): PluginRecorder {
  const listeners = new Map<string, (info: unknown) => void>()
  const browserOpen = vi.fn(async () => undefined)
  const clipboardWrite = vi.fn(async () => undefined)
  const plugins: WrapperPlugins = {
    secureStorage: {
      get: async (key: string) => {
        order.push("storage.get")
        return storage.get(key)
      },
      set: (key: string, value: string) => storage.set(key, value),
      remove: (key: string) => storage.remove(key),
    },
    statusBar: { setOverlaysWebView: vi.fn(async () => undefined) },
    splashScreen: {
      hide: vi.fn(async () => {
        order.push("splash.hide")
      }),
    },
    keyboard: {
      addListener: async (event: string, listener: (info: never) => void) => {
        listeners.set(event, listener as (info: unknown) => void)
        return { remove: async () => undefined }
      },
    },
    app: {
      addListener: async (event: string, listener: (info: never) => void) => {
        listeners.set(event, listener as (info: unknown) => void)
        return { remove: async () => undefined }
      },
    },
    browser: { open: browserOpen },
    clipboard: { write: clipboardWrite },
  } as unknown as WrapperPlugins
  return { plugins, listeners, order, browserOpen, clipboardWrite }
}

let release: (() => void) | null = null

beforeEach(() => {
  vi.stubEnv(API_URL_ENV_VAR, ORIGIN)
})

afterEach(() => {
  release?.()
  release = null
  setAuthTransport({ kind: "cookie" })
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("wrapper runtime auth", () => {
  it("sends the bearer header and never a credentials mode", async () => {
    const { storage } = createMemoryStorage({ [KEY]: SEEDED })
    const fetchMock = installFetch(async () => jsonResponse(200, ADMIN_USER))
    release = await installWrapperRuntime({
      isNativePlatform: () => true,
      storageKey: KEY,
      plugins: createPlugins(storage).plugins,
    })

    await apiFetch("/auth/me", { schema: authUserSchema })

    const [url, init] = fetchMock.mock.calls[0] ?? []
    const headers = new Headers(init?.headers)
    expect(String(url)).toBe(`${ORIGIN}/auth/me`)
    expect(headers.get("Authorization")).toBe("Bearer access-1")
    expect(init?.credentials).toBe("omit")
    expect(String(url)).not.toContain("access-1")
  })

  it("persists the rotated pair before any waiter retries", async () => {
    const { storage, entries } = createMemoryStorage({ [KEY]: SEEDED })
    const calls: string[] = []
    let storedAtRetry: string | null = null
    installFetch(async (url, init) => {
      if (url.endsWith("/auth/refresh")) {
        calls.push("refresh")
        return jsonResponse(200, {
          ...AUTH_BODY,
          access_token: "access-2",
          refresh_token: "refresh-2",
        })
      }
      if (new Headers(init?.headers).get("Authorization") === "Bearer access-1") {
        calls.push("unauthorized")
        return jsonResponse(401, { detail: "expired" })
      }
      calls.push("retry")
      storedAtRetry = entries.get(KEY) ?? null
      return jsonResponse(200, ADMIN_USER)
    })
    release = await installWrapperRuntime({
      isNativePlatform: () => true,
      storageKey: KEY,
      plugins: createPlugins(storage).plugins,
    })

    await apiFetch("/auth/me", { schema: authUserSchema })

    expect(calls).toEqual(["unauthorized", "refresh", "retry"])
    expect(parseTokens(storedAtRetry)).toEqual({ accessToken: "access-2", refreshToken: "refresh-2" })
  })

  it("raises the specified inline error when a server exposes no tokens", async () => {
    const { storage } = createMemoryStorage()
    release = await installWrapperRuntime({
      isNativePlatform: () => true,
      storageKey: KEY,
      plugins: createPlugins(storage).plugins,
    })

    await expect(completeAuthentication(AUTH_BODY)).rejects.toMatchObject({
      status: 422,
      detail: WRAPPER_TOKENS_MISSING_MESSAGE,
    })
    expect(getAuthState().user).toBeNull()
  })

  it("clears the stored pair when the session is wiped", async () => {
    const { storage, entries } = createMemoryStorage({ [KEY]: SEEDED })
    release = await installWrapperRuntime({
      isNativePlatform: () => true,
      storageKey: KEY,
      plugins: createPlugins(storage).plugins,
    })
    expect(entries.has(KEY)).toBe(true)

    const { clearSession } = await import("@/lib/auth-store")
    clearSession()

    expect(entries.has(KEY)).toBe(false)
  })
})

describe("wrapper device behaviours", () => {
  it("hides the native splash only after the auth check resolves", async () => {
    const { storage } = createMemoryStorage({ [KEY]: SEEDED })
    const order: string[] = []
    release = await installWrapperRuntime({
      isNativePlatform: () => true,
      storageKey: KEY,
      plugins: createPlugins(storage, order).plugins,
    })

    expect(order).toEqual(["storage.get", "splash.hide"])
  })

  it("drives the backgrounded flag from appStateChange", async () => {
    const { storage } = createMemoryStorage()
    const recorder = createPlugins(storage)
    release = await installWrapperRuntime({
      isNativePlatform: () => true,
      storageKey: KEY,
      plugins: recorder.plugins,
    })

    recorder.listeners.get("appStateChange")?.({ isActive: false })
    expect(isAppBackgrounded()).toBe(true)

    recorder.listeners.get("appStateChange")?.({ isActive: true })
    expect(isAppBackgrounded()).toBe(false)
  })

  it("routes the hardware back button through the back interceptor", async () => {
    const { storage } = createMemoryStorage()
    const recorder = createPlugins(storage)
    const interceptor = vi.fn(() => true)
    const releaseNavigation = installBackNavigation({ canGoBack: () => false, goBack: () => undefined })
    const releaseInterceptor = pushBackInterceptor(interceptor)
    release = await installWrapperRuntime({
      isNativePlatform: () => true,
      storageKey: KEY,
      plugins: recorder.plugins,
    })

    recorder.listeners.get("backButton")?.({})

    expect(interceptor).toHaveBeenCalledTimes(1)
    releaseInterceptor()
    releaseNavigation()
  })

  it("opens an external link in the system browser and leaves internal links alone", async () => {
    const { storage } = createMemoryStorage()
    const recorder = createPlugins(storage)
    release = await installWrapperRuntime({
      isNativePlatform: () => true,
      storageKey: KEY,
      plugins: recorder.plugins,
    })
    document.body.innerHTML =
      '<a id="external" href="https://example.com/watch">watch</a><a id="internal" href="/sessions">sessions</a>'

    document
      .getElementById("external")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    expect(recorder.browserOpen).toHaveBeenCalledWith({ url: "https://example.com/watch" })

    document
      .getElementById("internal")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    expect(recorder.browserOpen).toHaveBeenCalledTimes(1)
  })

  it("falls back to the platform clipboard when the async API is missing", async () => {
    const { storage } = createMemoryStorage()
    const recorder = createPlugins(storage)
    const original = Object.getOwnPropertyDescriptor(navigator, "clipboard")
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true })
    try {
      release = await installWrapperRuntime({
        isNativePlatform: () => true,
        storageKey: KEY,
        plugins: recorder.plugins,
      })

      await expect(copyText("origin-hash")).resolves.toBe(true)
      expect(recorder.clipboardWrite).toHaveBeenCalledWith({ string: "origin-hash" })
    } finally {
      if (original === undefined) delete (navigator as { clipboard?: unknown }).clipboard
      else Object.defineProperty(navigator, "clipboard", original)
    }
  })

  it("drives the CSS keyboard inset through the plugin listener wiring over a mocked bridge", async () => {
    // The mocked plugin handle takes the documented Capacitor JS API shape:
    // `addListener(eventName, listener)`, handing back the registered callback.
    const bridge = new Map<string, (info: unknown) => void>()
    const keyboard = {
      addListener: async (eventName: string, listener: (info: unknown) => void) => {
        bridge.set(eventName, listener)
        return { remove: async () => undefined }
      },
    } as unknown as WrapperPlugins["keyboard"]

    const { storage } = createMemoryStorage()
    const releaseKeyboard = installKeyboardInset()
    try {
      release = await installWrapperRuntime({
        isNativePlatform: () => true,
        storageKey: KEY,
        plugins: { ...createPlugins(storage).plugins, keyboard },
      })

      bridge.get("keyboardWillShow")?.({ keyboardHeight: 312 })
      expect(document.documentElement.style.getPropertyValue("--keyboard-inset")).toBe("312px")

      bridge.get("keyboardWillHide")?.({})
      expect(document.documentElement.style.getPropertyValue("--keyboard-inset")).toBe("0px")
    } finally {
      releaseKeyboard()
    }
  })
})
