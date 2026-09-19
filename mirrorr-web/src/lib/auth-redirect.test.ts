import { describe, expect, it } from "vitest"
import {
  DEFAULT_POST_LOGIN_PATH,
  postLoginPath,
  sanitizeRedirectPath,
} from "@/lib/auth-redirect"

/**
 * The `?redirect` contract (docs/web-frontend-spec.md L31, L35, L53): only a
 * same-origin PATH is honoured; anything that could leave the origin falls
 * back to `/sessions`.
 */
describe("sanitizeRedirectPath", () => {
  it("accepts a same-origin path including search and hash", () => {
    expect(sanitizeRedirectPath("/autoruns")).toBe("/autoruns")
    expect(sanitizeRedirectPath("/autoruns?filter=live")).toBe("/autoruns?filter=live")
    expect(sanitizeRedirectPath("/sessions/12#log")).toBe("/sessions/12#log")
  })

  it("rejects protocol-relative and absolute targets", () => {
    expect(sanitizeRedirectPath("//evil.example.com")).toBeNull()
    expect(sanitizeRedirectPath("//evil.example.com/login")).toBeNull()
    expect(sanitizeRedirectPath("https://evil.example.com")).toBeNull()
    expect(sanitizeRedirectPath("http://evil.example.com/login")).toBeNull()
  })

  it("rejects empty, relative and non-string values", () => {
    expect(sanitizeRedirectPath("")).toBeNull()
    expect(sanitizeRedirectPath("sessions")).toBeNull()
    expect(sanitizeRedirectPath(undefined)).toBeNull()
    expect(sanitizeRedirectPath(42)).toBeNull()
  })
})

describe("postLoginPath", () => {
  it("falls back to /sessions whenever the candidate is absent or unsafe", () => {
    expect(postLoginPath(undefined)).toBe(DEFAULT_POST_LOGIN_PATH)
    expect(postLoginPath("//evil.example.com")).toBe(DEFAULT_POST_LOGIN_PATH)
    expect(postLoginPath("/autoruns")).toBe("/autoruns")
  })
})
