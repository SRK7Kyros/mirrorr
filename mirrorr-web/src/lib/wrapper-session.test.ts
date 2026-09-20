import { afterEach, describe, expect, it, vi } from "vitest"
import { API_URL_ENV_VAR } from "@/config/env"
import {
  WRAPPER_TOKEN_KEY_PREFIX,
  apiOrigin,
  createWrapperSession,
  parseTokens,
  tokenStorageKey,
  tokensFromResponse,
  type SecureTokenStorage,
  type WrapperTokens,
} from "@/lib/wrapper-session"
import { AUTH_BODY } from "@/test/api-helpers"

const ORIGIN = "https://core.example.com"
const KEY = `${WRAPPER_TOKEN_KEY_PREFIX}${ORIGIN}`
const FIRST_PAIR: WrapperTokens = { accessToken: "access-1", refreshToken: "refresh-1" }
const SECOND_PAIR: WrapperTokens = { accessToken: "access-2", refreshToken: "refresh-2" }

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

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("wrapper token storage", () => {
  it("keys the pair by the API origin so another server's tokens are unreadable", () => {
    vi.stubEnv(API_URL_ENV_VAR, ORIGIN)
    expect(apiOrigin()).toBe(ORIGIN)
    expect(tokenStorageKey()).toBe(KEY)

    vi.stubEnv(API_URL_ENV_VAR, "https://other.example.com")
    expect(tokenStorageKey()).toBe(`${WRAPPER_TOKEN_KEY_PREFIX}https://other.example.com`)
  })

  it("persists both tokens on login and serves the access token", async () => {
    const { storage, entries } = createMemoryStorage()
    const session = createWrapperSession({ storage, key: KEY })

    await expect(
      session.persistLogin({ ...AUTH_BODY, access_token: FIRST_PAIR.accessToken, refresh_token: FIRST_PAIR.refreshToken }),
    ).resolves.toBe(true)

    expect(session.getAccessToken()).toBe(FIRST_PAIR.accessToken)
    expect(parseTokens(entries.get(KEY) ?? null)).toEqual(FIRST_PAIR)
  })

  it("refuses a login response that exposes no pair", async () => {
    const { storage, entries } = createMemoryStorage()
    const session = createWrapperSession({ storage, key: KEY })

    await expect(session.persistLogin(AUTH_BODY)).resolves.toBe(false)
    await expect(
      session.persistLogin({ ...AUTH_BODY, access_token: "only-access" }),
    ).resolves.toBe(false)

    expect(session.getAccessToken()).toBeNull()
    expect(entries.size).toBe(0)
    expect(tokensFromResponse(AUTH_BODY)).toBeNull()
  })

  it("replaces the stored pair when a refresh rotates it", async () => {
    const { storage, entries } = createMemoryStorage()
    const session = createWrapperSession({ storage, key: KEY })
    await session.persistLogin({
      ...AUTH_BODY,
      access_token: FIRST_PAIR.accessToken,
      refresh_token: FIRST_PAIR.refreshToken,
    })

    await session.persistRotatedPair({
      ...AUTH_BODY,
      access_token: SECOND_PAIR.accessToken,
      refresh_token: SECOND_PAIR.refreshToken,
    })

    expect(session.getAccessToken()).toBe(SECOND_PAIR.accessToken)
    expect(parseTokens(entries.get(KEY) ?? null)).toEqual(SECOND_PAIR)
    expect(entries.get(KEY)).not.toContain(FIRST_PAIR.refreshToken)
  })

  it("fails a rotation that exposes no pair rather than keeping the old one", async () => {
    const { storage } = createMemoryStorage()
    const session = createWrapperSession({ storage, key: KEY })

    await expect(session.persistRotatedPair(AUTH_BODY)).rejects.toThrow(/no token pair/)
  })

  it("restores a stored pair and discards a corrupt entry", async () => {
    const restored = createMemoryStorage({ [KEY]: JSON.stringify(FIRST_PAIR) })
    const session = createWrapperSession({ storage: restored.storage, key: KEY })
    await expect(session.restore()).resolves.toEqual(FIRST_PAIR)
    expect(session.getAccessToken()).toBe(FIRST_PAIR.accessToken)

    const corrupt = createMemoryStorage({ [KEY]: "not-json" })
    const second = createWrapperSession({ storage: corrupt.storage, key: KEY })
    await expect(second.restore()).resolves.toBeNull()
    expect(second.getAccessToken()).toBeNull()
    expect(corrupt.entries.has(KEY)).toBe(false)
  })

  it("clears the pair on every wipe and survives a keystore failure", async () => {
    const { storage, entries } = createMemoryStorage({ [KEY]: JSON.stringify(FIRST_PAIR) })
    const session = createWrapperSession({ storage, key: KEY })
    await session.restore()

    await expect(session.clear()).resolves.toBe(true)
    expect(session.getAccessToken()).toBeNull()
    expect(entries.has(KEY)).toBe(false)

    const failing = createMemoryStorage({ [KEY]: JSON.stringify(FIRST_PAIR) })
    const broken: SecureTokenStorage = {
      ...failing.storage,
      remove: async () => {
        throw new Error("keystore unavailable")
      },
    }
    const stubborn = createWrapperSession({ storage: broken, key: KEY })
    await stubborn.restore()
    await expect(stubborn.clear()).resolves.toBe(false)
    expect(stubborn.getAccessToken()).toBeNull()
  })

  it("never logs a token", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const { storage } = createMemoryStorage()
    const session = createWrapperSession({ storage, key: KEY })

    await session.persistLogin({
      ...AUTH_BODY,
      access_token: FIRST_PAIR.accessToken,
      refresh_token: FIRST_PAIR.refreshToken,
    })
    await session.restore()
    await session.clear()

    const printed = [...log.mock.calls, ...warn.mock.calls, ...error.mock.calls]
      .flat()
      .map((value) => String(value))
      .join(" ")
    expect(printed).not.toContain(FIRST_PAIR.accessToken)
    expect(printed).not.toContain(FIRST_PAIR.refreshToken)
  })
})
