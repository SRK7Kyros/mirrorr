/**
 * The one seam between the console and the native app that may be hosting it.
 *
 * The phone app is deliberately a *remote shell*: it loads this console from
 * the host's own origin, so sessions, `/api` and `/ws` behave exactly as they
 * do in a browser. Capacitor injects `window.Capacitor` (the plugin bridge)
 * into the main frame of every page it loads — remote origins included — which
 * is what lets the console read storage a plain browser page cannot reach.
 *
 * Everything here is inert in a browser (`isNativeShell()` is false), which is
 * what keeps the web build free of any native-only affordance.
 */

/**
 * The keychain entry the two pages address. The plugin layers its own
 * `capacitor-storage_` prefix over the app's, and its native methods take one
 * options object whose key is already at that final form (`prefixedKey`).
 */
const KEYCHAIN_PREFIX = "capacitor-storage_"
const CREDENTIAL_KEY_PREFIX = "mirrorr.cred."

/**
 * The shell's own bundled content — the server picker (`webDir` =
 * `mobile/launcher`), served from Capacitor's local origin. Its iOS navigation
 * policy allows a top-level navigation back to this URL, so linking here is how
 * the console hands control back to the server list.
 */
export const HOST_PICKER_URL = "capacitor://localhost/"

export interface HostCredential {
  readonly username: string
  readonly password: string
}

type BridgeMethod = (options: Readonly<Record<string, unknown>>) => Promise<unknown>

interface NativeBridge {
  readonly isNativePlatform?: () => boolean
  readonly Plugins?: Readonly<Record<string, Readonly<Record<string, BridgeMethod>>>>
}

function bridge(): NativeBridge | null {
  const candidate = (globalThis as { Capacitor?: unknown }).Capacitor
  return typeof candidate === "object" && candidate !== null ? (candidate as NativeBridge) : null
}

/** True only when the page is hosted by the native app — never in a browser. */
export function isNativeShell(): boolean {
  return bridge()?.isNativePlatform?.() === true
}

/**
 * The credentials the picker saved for one host, or `null` when there are none
 * (a browser, no entry, or a keychain the OS refused to open). This never
 * throws: an unreachable keychain must fall back to the ordinary sign-in form,
 * not break the login screen.
 */
export async function readHostCredential(origin: string): Promise<HostCredential | null> {
  const getItem = bridge()?.Plugins?.["SecureStorage"]?.["internalGetItem"]
  if (getItem === undefined) return null
  try {
    const result = (await getItem({
      prefixedKey: `${KEYCHAIN_PREFIX}${CREDENTIAL_KEY_PREFIX}${origin}`,
      sync: false,
    })) as { readonly data?: unknown } | null
    const stored = result?.data
    const parsed: unknown = typeof stored === "string" ? JSON.parse(stored) : stored
    if (parsed === null || typeof parsed !== "object") return null
    const { username, password } = parsed as { username?: unknown; password?: unknown }
    if (typeof username !== "string" || typeof password !== "string") return null
    if (username === "" || password === "") return null
    return { username, password }
  } catch {
    return null
  }
}
