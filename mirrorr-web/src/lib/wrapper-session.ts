/**
 * The Capacitor wrapper's token store (spec L593-L600).
 *
 * Bearer is the wrapper's auth contract: the page origin is cross-site, so the
 * httpOnly cookie is not reliably attached, and the pair belongs in the platform
 * keystore rather than localStorage. This module owns that pair's lifecycle —
 * restore, persist on login, persist on rotation, clear on every wipe — keyed by
 * API origin, so a build pointed at another server can never read the first
 * server's tokens.
 */
import { getApiBaseUrl } from "@/config/env"
import type { AuthResponse } from "@/lib/schemas/auth"

export const WRAPPER_TOKEN_KEY_PREFIX = "mirrorr.tokens:"

export interface SecureTokenStorage {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

export interface WrapperTokens {
  readonly accessToken: string
  readonly refreshToken: string
}

/**
 * The token key's origin. A production `VITE_API_URL` is absolute, so the origin
 * is the server's; a relative one (`/api`, the dev proxy shape) has no origin of
 * its own, and there the page origin is the same-origin API's origin.
 */
export function apiOrigin(baseUrl: string = getApiBaseUrl()): string {
  return new URL(baseUrl, window.location.href).origin
}

export function tokenStorageKey(origin: string = apiOrigin()): string {
  return `${WRAPPER_TOKEN_KEY_PREFIX}${origin}`
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

/** Both tokens or nothing: half a pair can only produce a 401 dance. */
export function tokensFromResponse(response: AuthResponse): WrapperTokens | null {
  if (!nonEmpty(response.access_token) || !nonEmpty(response.refresh_token)) return null
  return { accessToken: response.access_token, refreshToken: response.refresh_token }
}

export function serializeTokens(tokens: WrapperTokens): string {
  return JSON.stringify(tokens)
}

export function parseTokens(raw: string | null): WrapperTokens | null {
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== "object") return null
    const candidate = parsed as { accessToken?: unknown; refreshToken?: unknown }
    if (!nonEmpty(candidate.accessToken) || !nonEmpty(candidate.refreshToken)) return null
    return { accessToken: candidate.accessToken, refreshToken: candidate.refreshToken }
  } catch {
    return null
  }
}

export interface WrapperSession {
  getAccessToken(): string | null
  restore(): Promise<WrapperTokens | null>
  /** `false` when the response exposed no pair — the caller raises the inline error. */
  persistLogin(response: AuthResponse): Promise<boolean>
  /** Rejects when the rotation exposed no pair, failing the refresh closed. */
  persistRotatedPair(response: AuthResponse): Promise<void>
  clear(): Promise<boolean>
}

export interface WrapperSessionOptions {
  readonly storage: SecureTokenStorage
  readonly key: string
}

export function createWrapperSession({ storage, key }: WrapperSessionOptions): WrapperSession {
  let tokens: WrapperTokens | null = null

  const write = async (next: WrapperTokens): Promise<void> => {
    await storage.set(key, serializeTokens(next))
    tokens = next
  }

  return {
    getAccessToken: () => tokens?.accessToken ?? null,

    async restore() {
      let raw: string | null
      try {
        raw = await storage.get(key)
      } catch {
        // An unreachable keystore must not block boot: nothing is restorable, so
        // the app starts signed out and the operator signs in again.
        return null
      }
      const stored = parseTokens(raw)
      if (stored === null) {
        // A corrupt entry cannot be trusted; drop it rather than retry forever.
        if (raw !== null) await storage.remove(key)
        tokens = null
        return null
      }
      tokens = stored
      return stored
    },

    async persistLogin(response) {
      const next = tokensFromResponse(response)
      if (next === null) return false
      await write(next)
      return true
    },

    async persistRotatedPair(response) {
      const next = tokensFromResponse(response)
      if (next === null) throw new Error("refresh response carried no token pair")
      await write(next)
    },

    async clear() {
      tokens = null
      try {
        await storage.remove(key)
        return true
      } catch {
        // A keystore failure must never block logout: the in-memory pair is
        // already gone, so this process cannot present the session again.
        return false
      }
    },
  }
}
