/**
 * Regression lock for the live `/auth/me` shape: the dev core answers with
 * explicit `null` tokens (`{"access_token": null, "refresh_token": null}`
 * alongside `"client": null`). `undefined`-only optionals made the guard's
 * schema parse fail and bounced a valid session to `/login`.
 */
import { describe, expect, it } from "vitest"
import { authResponseSchema } from "@/lib/schemas/auth"

const USER = { id: 1, username: "admin", role: "admin", display_name: "Admin" }

describe("authResponseSchema", () => {
  it("accepts explicit null tokens and a null client", () => {
    const parsed = authResponseSchema.parse({
      user: USER,
      client: null,
      access_token: null,
      refresh_token: null,
    })

    expect(parsed.user?.role).toBe("admin")
    expect(parsed.access_token).toBeNull()
    expect(parsed.refresh_token).toBeNull()
  })

  it("accepts token strings and an omitted client", () => {
    const parsed = authResponseSchema.parse({
      user: USER,
      access_token: "access",
      refresh_token: "refresh",
    })

    expect(parsed.access_token).toBe("access")
    expect(parsed.refresh_token).toBe("refresh")
  })

  it("accepts the API-client principal shape (user null, client set)", () => {
    const parsed = authResponseSchema.parse({
      user: null,
      client: { id: 7, name: "ops-key" },
    })

    expect(parsed.user).toBeNull()
    expect(parsed.client?.name).toBe("ops-key")
  })
})
