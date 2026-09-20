/**
 * The Capacitor wrapper runtime (spec L593-L616).
 *
 * Installed for every build. In a browser it owns only the lifecycle policy
 * (visibilitychange source); on a native platform it additionally switches the
 * API client to bearer mode, moves the token pair into the platform keystore,
 * and wires the device behaviours. Every native dependency is reached through a
 * dynamic import, so the web bundle neither ships nor evaluates plugin code, and
 * the whole plugin surface is injectable — which is how the tests drive the real
 * Capacitor plugin path over a mocked bridge.
 */
import { refreshSessionIfStale, setAuthTransport, setRefreshPersister } from "@/lib/api"
import { installAppLifecycle } from "@/lib/app-lifecycle"
import { setSessionLifecycleHooks } from "@/lib/auth-store"
import { setClipboardWriter } from "@/lib/clipboard"
import { ApiError } from "@/lib/errors"
import { createWrapperSession, tokenStorageKey, type SecureTokenStorage } from "@/lib/wrapper-session"

/** Spec L593: shown inline when a server does not expose the wrapper's tokens. */
export const WRAPPER_TOKENS_MISSING_MESSAGE =
  "This server does not expose app tokens — sign in with the web UI"

const KEYBOARD_SHOW_EVENT = "keyboardWillShow"
const KEYBOARD_HIDE_EVENT = "keyboardWillHide"
const PLATFORM_BACK_EVENT = "mirrorr:back"
const EXTERNAL_PROTOCOLS = new Set(["http:", "https:"])

interface ListenerHandle {
  remove(): Promise<void>
}

export interface WrapperPlugins {
  readonly secureStorage: SecureTokenStorage
  readonly statusBar?: { setOverlaysWebView(options: { overlay: boolean }): Promise<void> }
  readonly splashScreen?: { hide(options?: { fadeOutDuration?: number }): Promise<void> }
  readonly keyboard?: {
    addListener(
      event: "keyboardWillShow",
      listener: (info: { keyboardHeight: number }) => void,
    ): Promise<ListenerHandle>
    addListener(event: "keyboardWillHide", listener: () => void): Promise<ListenerHandle>
  }
  readonly app?: {
    addListener(
      event: "appStateChange",
      listener: (state: { isActive: boolean }) => void,
    ): Promise<ListenerHandle>
    addListener(event: "backButton", listener: () => void): Promise<ListenerHandle>
  }
  readonly browser?: { open(options: { url: string }): Promise<void> }
  readonly clipboard?: { write(options: { string: string }): Promise<void> }
}

export interface WrapperRuntimeOptions {
  readonly refetchVisible?: () => void
  readonly plugins?: WrapperPlugins
  readonly isNativePlatform?: () => boolean
  readonly storageKey?: string
}

/**
 * The wrapper document of record declares itself (mobile.html), which is a stronger
 * signal than the native bridge: the plugins key off that same bridge, so a bridge
 * that exists without a native host would select a keystore implementation that
 * cannot work. The bridge stays a fallback for a document that forgets the marker.
 */
function detectNativePlatform(): boolean {
  if (document.documentElement.dataset.wrapper === "capacitor") return true
  const bridge = window as Window & {
    CapacitorCustomPlatform?: { name: string }
    androidBridge?: unknown
    webkit?: { messageHandlers?: { bridge?: unknown } }
  }
  if (bridge.CapacitorCustomPlatform !== undefined) {
    return bridge.CapacitorCustomPlatform.name !== "web"
  }
  if (bridge.androidBridge !== undefined) return true
  return bridge.webkit?.messageHandlers?.bridge !== undefined
}

async function loadNativePlugins(): Promise<WrapperPlugins> {
  const [secureStorage, app, browser, statusBar, splashScreen, keyboard, clipboard] = await Promise.all([
    import("@aparajita/capacitor-secure-storage"),
    import("@capacitor/app"),
    import("@capacitor/browser"),
    import("@capacitor/status-bar"),
    import("@capacitor/splash-screen"),
    import("@capacitor/keyboard"),
    import("@capacitor/clipboard"),
  ])
  const storage = secureStorage.SecureStorage
  return {
    // The plugin's own `get` decodes its stored type; the token pair is a string
    // we serialized ourselves, so the raw accessors are the honest adapter.
    secureStorage: {
      get: (key) => storage.getItem(key),
      set: (key, value) => storage.setItem(key, value),
      remove: async (key) => {
        await storage.remove(key)
      },
    },
    app: app.App,
    browser: browser.Browser,
    statusBar: statusBar.StatusBar,
    splashScreen: splashScreen.SplashScreen,
    keyboard: keyboard.Keyboard,
    clipboard: clipboard.Clipboard,
  }
}

/** Device polish must never block boot: a missing plugin degrades, never fails. */
async function deviceStep(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run()
  } catch (error) {
    console.warn(`[mirrorr-wrapper] ${label} unavailable`, error)
  }
}

async function addPluginListener(register: () => Promise<ListenerHandle>): Promise<() => void> {
  try {
    const handle = await register()
    return () => {
      void handle.remove()
    }
  } catch (error) {
    console.warn("[mirrorr-wrapper] listener unavailable", error)
    return () => undefined
  }
}

function externalHref(href: string): string | null {
  try {
    const url = new URL(href, window.location.href)
    if (!EXTERNAL_PROTOCOLS.has(url.protocol)) return null
    if (url.origin === window.location.origin) return null
    return url.href
  } catch {
    return null
  }
}

export async function installWrapperRuntime(options: WrapperRuntimeOptions = {}): Promise<() => void> {
  const refetchVisible = options.refetchVisible ?? (() => undefined)
  const isNative = options.isNativePlatform ?? detectNativePlatform()

  if (!isNative) {
    return installAppLifecycle({ refetchVisible })
  }

  const plugins = options.plugins ?? (await loadNativePlugins())
  const session = createWrapperSession({
    storage: plugins.secureStorage,
    key: options.storageKey ?? tokenStorageKey(),
  })

  setAuthTransport({ kind: "bearer", getAccessToken: () => session.getAccessToken() })
  setRefreshPersister((response) => session.persistRotatedPair(response))
  setSessionLifecycleHooks({
    onAuthenticated: async (response) => {
      if (!(await session.persistLogin(response))) {
        throw new ApiError({ status: 422, detail: WRAPPER_TOKENS_MISSING_MESSAGE })
      }
    },
    onCleared: () => {
      void session.clear()
    },
  })

  // The auth check whose resolution releases the native splash.
  await session.restore()

  const releases: Array<() => void> = []

  let emitHidden: ((hidden: boolean) => void) | null = null
  releases.push(
    installAppLifecycle({
      refetchVisible,
      subscribeVisibility: (listener) => {
        emitHidden = listener
        return () => {
          emitHidden = null
        }
      },
    }),
  )

  const statusBar = plugins.statusBar
  if (statusBar !== undefined) {
    await deviceStep("status bar", () => statusBar.setOverlaysWebView({ overlay: true }))
  }

  const splashScreen = plugins.splashScreen
  if (splashScreen !== undefined) {
    await deviceStep("splash screen", () => splashScreen.hide({ fadeOutDuration: 0 }))
  }

  const keyboard = plugins.keyboard
  if (keyboard !== undefined) {
    releases.push(
      await addPluginListener(() =>
        keyboard.addListener(KEYBOARD_SHOW_EVENT, (info) => {
          window.dispatchEvent(
            new CustomEvent(KEYBOARD_SHOW_EVENT, { detail: { keyboardHeight: info.keyboardHeight } }),
          )
        }),
      ),
    )
    releases.push(
      await addPluginListener(() =>
        keyboard.addListener(KEYBOARD_HIDE_EVENT, () => {
          window.dispatchEvent(new CustomEvent(KEYBOARD_HIDE_EVENT, { detail: {} }))
        }),
      ),
    )
  }

  const app = plugins.app
  if (app !== undefined) {
    releases.push(
      await addPluginListener(() =>
        app.addListener("appStateChange", (state) => {
          emitHidden?.(!state.isActive)
          if (state.isActive) refreshSessionIfStale()
        }),
      ),
    )
    releases.push(
      await addPluginListener(() =>
        app.addListener("backButton", () => {
          window.dispatchEvent(new Event(PLATFORM_BACK_EVENT))
        }),
      ),
    )

    const onDocumentClick = (event: MouseEvent): void => {
      const target = event.target
      const anchor = target instanceof Element ? target.closest("a[href]") : null
      const href = anchor?.getAttribute("href")
      if (href === undefined || href === null) return
      const url = externalHref(href)
      if (url === null) return
      const browser = plugins.browser
      if (browser === undefined) return
      event.preventDefault()
      void deviceStep("external link", () => browser.open({ url }))
    }
    document.addEventListener("click", onDocumentClick)
    releases.push(() => document.removeEventListener("click", onDocumentClick))
  }

  const clipboard = plugins.clipboard
  if (clipboard !== undefined) {
    setClipboardWriter((text) => clipboard.write({ string: text }))
    releases.push(() => setClipboardWriter(null))
  }

  return () => {
    for (const release of releases.reverse()) release()
    setSessionLifecycleHooks(null)
    setRefreshPersister(null)
    setAuthTransport({ kind: "cookie" })
  }
}
