import { beforeEach, describe, expect, it, vi } from "vitest"
import { API_URL_ENV_VAR } from "@/config/env"
import { ApiError } from "@/lib/errors"
import {
  createApiClient,
  createUser,
  deleteApiClient,
  deleteUser,
  fetchClients,
  fetchUsers,
} from "@/lib/settings-api"
import { installFetch, jsonResponse } from "@/test/api-helpers"

interface RecordedCall {
  readonly url: string
  readonly method: string
  readonly body: unknown
}

function recordFetch(
  respond: (call: RecordedCall) => Promise<Response>,
): { calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  installFetch((url, init) => {
    const call: RecordedCall = {
      url,
      method: init?.method ?? "GET",
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    }
    calls.push(call)
    return respond(call)
  })
  return { calls }
}

beforeEach(() => {
  vi.stubEnv(API_URL_ENV_VAR, "/api")
  vi.restoreAllMocks()
})

describe("settings-api", () => {
  it("lists users from GET /auth/users and keeps the contract fields", async () => {
    const { calls } = recordFetch(async () =>
      jsonResponse(200, [
        { id: 1, username: "admin", role: "admin", display_name: "Admin", password_hash: "x" },
        { id: 2, username: "bob", role: "user", display_name: null },
      ]),
    )

    const users = await fetchUsers()

    expect(calls[0]?.url).toBe("/api/auth/users")
    expect(calls[0]?.method).toBe("GET")
    expect(users).toEqual([
      { id: 1, username: "admin", role: "admin", display_name: "Admin" },
      { id: 2, username: "bob", role: "user", display_name: null },
    ])
  })

  it("creates a user through the admin-gated register endpoint", async () => {
    const { calls } = recordFetch(async () =>
      jsonResponse(200, {
        user: { id: 7, username: "qa-user", role: "user", display_name: "QA" },
        client: null,
      }),
    )

    const result = await createUser({ username: "qa-user", password: "password123", displayName: "QA" })

    expect(calls[0]?.url).toBe("/api/auth/register")
    expect(calls[0]?.method).toBe("POST")
    expect(calls[0]?.body).toEqual({
      username: "qa-user",
      password: "password123",
      display_name: "QA",
    })
    expect(result).toEqual({
      kind: "created",
      user: { id: 7, username: "qa-user", role: "user", display_name: "QA" },
    })
  })

  it("omits display_name when blank and reports a pending registration", async () => {
    const { calls } = recordFetch(async () =>
      jsonResponse(202, { status: "pending", username: "qa-user" }),
    )

    const result = await createUser({ username: "qa-user", password: "password123", displayName: "  " })

    expect(calls[0]?.body).toEqual({ username: "qa-user", password: "password123" })
    expect(result).toEqual({ kind: "pending", username: "qa-user" })
  })

  it("deletes a user by username and surfaces the last-admin 400 detail", async () => {
    const { calls } = recordFetch(async (call) =>
      call.url.endsWith("/admin")
        ? jsonResponse(400, { detail: "Cannot delete the last admin user" })
        : jsonResponse(200, { status: "deleted", username: "bob" }),
    )

    await deleteUser("bob")
    expect(calls[0]?.url).toBe("/api/auth/users/bob")
    expect(calls[0]?.method).toBe("DELETE")

    await expect(deleteUser("admin")).rejects.toMatchObject({
      status: 400,
      detail: "Cannot delete the last admin user",
    })
  })

  it("maps the server's created-client envelope onto {client, apiKey} without the hash", async () => {
    const { calls } = recordFetch(async () =>
      jsonResponse(200, {
        client: {
          is_active: true,
          id: 3,
          name: "ci",
          api_key_hash: "deadbeef",
          created_at: "2026-09-20T01:14:21.893016",
        },
        api_key: "plaintext-key",
      }),
    )

    const created = await createApiClient("ci")

    expect(calls[0]?.url).toBe("/api/auth/clients")
    expect(calls[0]?.method).toBe("POST")
    expect(calls[0]?.body).toEqual({ name: "ci" })
    expect(created).toEqual({
      client: { id: 3, name: "ci", is_active: true, created_at: "2026-09-20T01:14:21.893016" },
      apiKey: "plaintext-key",
    })
  })

  it("lists and revokes API clients", async () => {
    const { calls } = recordFetch(async (call) =>
      call.method === "DELETE"
        ? jsonResponse(200, { status: "deleted" })
        : jsonResponse(200, [
            { is_active: true, id: 1, name: "one", api_key_hash: "x", created_at: null },
          ]),
    )

    const clients = await fetchClients()
    expect(clients).toEqual([{ id: 1, name: "one", is_active: true, created_at: null }])
    expect(calls[0]?.url).toBe("/api/auth/clients")

    await deleteApiClient(1)
    expect(calls[1]?.url).toBe("/api/auth/clients/1")
    expect(calls[1]?.method).toBe("DELETE")
  })

  it("propagates ApiError for a rejected delete", async () => {
    recordFetch(async () => jsonResponse(404, { detail: "User not found" }))
    await expect(deleteUser("ghost")).rejects.toBeInstanceOf(ApiError)
  })
})
