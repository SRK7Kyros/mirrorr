import { vi } from "vitest"

export const AUTH_BODY = {
  user: { id: 1, username: "admin", role: "admin", display_name: "Admin" },
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

export function installFetch(handler: (url: string, init: RequestInit | undefined) => Promise<Response>) {
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init))
  vi.stubGlobal("fetch", mock)
  return mock
}
