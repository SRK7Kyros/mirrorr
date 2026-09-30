import { afterEach, describe, expect, it, vi } from "vitest"
import {
  API_URL_ENV_VAR,
  assertApiConfig,
  getApiBaseUrl,
  getWsEventsUrl,
  getWsNotificationsUrl,
  parseApiBaseUrl,
} from "@/config/env"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("parseApiBaseUrl (contract validation)", () => {
  it("accepts a root-relative base unchanged", () => {
    expect(parseApiBaseUrl("/api")).toBe("/api")
  })

  it("accepts absolute http(s) origins, with or without a path", () => {
    expect(parseApiBaseUrl("http://127.0.0.1:8000")).toBe("http://127.0.0.1:8000")
    expect(parseApiBaseUrl("https://mirrorr.example.org/api")).toBe(
      "https://mirrorr.example.org/api",
    )
  })

  it("trims surrounding whitespace", () => {
    expect(parseApiBaseUrl("  /api  ")).toBe("/api")
  })

  it("rejects a missing value, naming VITE_API_URL", () => {
    expect(() => parseApiBaseUrl(undefined)).toThrowError(API_URL_ENV_VAR)
  })

  it("rejects a blank value, naming VITE_API_URL", () => {
    expect(() => parseApiBaseUrl("   ")).toThrowError(API_URL_ENV_VAR)
  })

  it("rejects a trailing slash", () => {
    expect(() => parseApiBaseUrl("/api/")).toThrowError(/trailing slash/)
    expect(() => parseApiBaseUrl("http://127.0.0.1:8000/")).toThrowError(/trailing slash/)
  })

  it("rejects values that are neither root-relative nor absolute http(s)", () => {
    expect(() => parseApiBaseUrl("localhost:8000")).toThrowError(API_URL_ENV_VAR)
    expect(() => parseApiBaseUrl("ftp://mirrorr.example.org")).toThrowError(API_URL_ENV_VAR)
  })
})

describe("boot configuration guard", () => {
  it("throws when VITE_API_URL is unset, naming the variable", () => {
    vi.stubEnv(API_URL_ENV_VAR, undefined)

    expect(() => assertApiConfig()).toThrowError(/VITE_API_URL/)
  })

  it("throws when VITE_API_URL is blank", () => {
    vi.stubEnv(API_URL_ENV_VAR, "")

    expect(() => assertApiConfig()).toThrowError(/VITE_API_URL/)
  })

  it("returns the configured base when set", () => {
    vi.stubEnv(API_URL_ENV_VAR, "/api")

    expect(assertApiConfig()).toBe("/api")
    expect(getApiBaseUrl()).toBe("/api")
  })
})

describe("WebSocket URL derivation", () => {
  it("derives ws://<page-origin>/ws/events from the relative /api base, never /api/ws/", () => {
    vi.stubEnv(API_URL_ENV_VAR, "/api")

    expect(getWsEventsUrl()).toBe(`ws://${window.location.host}/ws/events`)
    expect(getWsNotificationsUrl()).toBe(`ws://${window.location.host}/ws/notifications`)
    expect(getWsEventsUrl()).not.toContain("/api/ws/")
  })

  it("maps an absolute https base to wss:// on its origin, dropping the base path", () => {
    vi.stubEnv(API_URL_ENV_VAR, "https://mirrorr.example.org/base")

    expect(getWsEventsUrl()).toBe("wss://mirrorr.example.org/ws/events")
    expect(getWsNotificationsUrl()).toBe("wss://mirrorr.example.org/ws/notifications")
    expect(getWsEventsUrl()).not.toContain("/base/ws/")
  })

  it("maps an absolute http base to ws:// and keeps its port", () => {
    vi.stubEnv(API_URL_ENV_VAR, "http://127.0.0.1:8000")

    expect(getWsEventsUrl()).toBe("ws://127.0.0.1:8000/ws/events")
  })
})
