import { z } from "zod"
import { ApiError, apiBase, apiFetch } from "@/api/client"
import { RegistrationPendingSchema } from "@/api/schemas/auth"
import { UserSchema, type User } from "@/api/schemas/user"

/**
 * View-layer fetchers for the settings surfaces (V12 Users / V13 API clients).
 *
 * Shapes are verified against mirrorr-core `api/routers/auth.py` and a live
 * smoke against :8000 — kept here (not in `src/lib/schemas/`) so the shared
 * contract modules stay untouched. Assumptions called out in comments.
 */

/** `GET /auth/registration-requests` row (admin; server-only, not in general-client-spec docs). */
const RegistrationRequestSchema = z
  .object({
    id: z.number(),
    username: z.string(),
    display_name: z.string(),
    /** `datetime | None` on the wire. */
    created_at: z.string().nullable(),
  })
  .passthrough()

export type RegistrationRequest = z.infer<typeof RegistrationRequestSchema>

/**
 * `GET /auth/clients` row — the server returns the raw `Client` SQLModel
 * (includes `api_key_hash`, which we never render). `is_active`/`created_at`
 * are optional-defensive: the model defaults them, but there is no
 * response_model pinning the shape.
 */
const ClientRowSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    is_active: z.boolean().optional(),
    created_at: z.string().nullish(),
  })
  .passthrough()

export type ClientRow = z.infer<typeof ClientRowSchema>

/**
 * `POST /auth/clients` response. The payload doc quotes
 * `{id, name, plaintext_key}` but the live server returns
 * `{client: <Client>, api_key: "<plaintext>"}` — smoke-verified Sep 2026.
 */
const CreateClientResponseSchema = z.object({
  client: ClientRowSchema,
  api_key: z.string().min(1),
})

const StatusSchema = z.object({ status: z.string() }).passthrough()

function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    console.warn("Unexpected server response", result.error)
    throw new ApiError(0, "Unexpected server response")
  }
  return result.data
}

// ── Users (V12) ─────────────────────────────────────────────────────

export function fetchUsers(): Promise<User[]> {
  return apiFetch<unknown>("/auth/users").then((data) =>
    parseOrThrow(z.array(UserSchema), data),
  )
}

export function deleteUser(username: string): Promise<void> {
  return apiFetch<unknown>(`/auth/users/${encodeURIComponent(username)}`, {
    method: "DELETE",
  }).then((data) => {
    parseOrThrow(StatusSchema, data)
  })
}

// ── Registration approval (V12 admin; endpoints exist on the server, L9) ─

export function fetchRegistrationRequests(): Promise<RegistrationRequest[]> {
  return apiFetch<unknown>("/auth/registration-requests").then((data) =>
    parseOrThrow(z.array(RegistrationRequestSchema), data),
  )
}

export function approveRegistrationRequest(id: number): Promise<void> {
  return apiFetch<unknown>(`/auth/registration-requests/${id}/approve`, {
    method: "POST",
  }).then((data) => {
    parseOrThrow(UserSchema, data)
  })
}

export function denyRegistrationRequest(id: number, reason = ""): Promise<void> {
  return apiFetch<unknown>(`/auth/registration-requests/${id}/deny`, {
    method: "POST",
    body: { reason },
  }).then((data) => {
    parseOrThrow(StatusSchema, data)
  })
}

/**
 * Anonymous `POST /auth/register` → 202 pending.
 *
 * Deliberately `credentials: "omit"`: calling register *with* the admin
 * cookie makes the server mint tokens for the NEW user and `Set-Cookie`
 * overwrites the admin session (smoke-proven hijack). With no ambient
 * cookie the server takes the pending branch, sets no cookies, and the
 * admin session survives — approval below then mints the live user.
 */
async function registerPending(
  username: string,
  password: string,
  displayName: string,
): Promise<z.infer<typeof RegistrationPendingSchema>> {
  const res = await fetch(`${apiBase()}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "omit",
    body: JSON.stringify({ username, password, display_name: displayName }),
  })
  if (res.status === 202) {
    const body: unknown = await res.json()
    return parseOrThrow(RegistrationPendingSchema, body)
  }
  if (res.status === 429) {
    throw new ApiError(429, "Too many attempts — try again shortly")
  }
  const record = (await res.json().catch(() => null)) as { detail?: unknown } | null
  const rawDetail = record?.detail
  let detail = `Request failed (${res.status})`
  if (typeof rawDetail === "string") {
    detail = rawDetail
  } else if (rawDetail !== null && typeof rawDetail === "object" && "detail" in rawDetail) {
    // FastAPI 409 collision/dedupe shape: { detail: { detail, rule } }.
    const nested = (rawDetail as { detail?: unknown }).detail
    if (typeof nested === "string") detail = nested
  }
  throw new ApiError(res.status, detail)
}

/**
 * New-user dialog submit: register (pending) → approve as admin.
 * End state identical to a direct admin register (role `user`), without
 * the cookie hijack. See `registerPending`.
 */
export async function createUser(
  username: string,
  password: string,
  displayName: string,
): Promise<void> {
  const pending = await registerPending(username, password, displayName)
  const requests = await fetchRegistrationRequests()
  const request = requests.find((item) => item.username === pending.username)
  if (!request) {
    throw new ApiError(0, "Unexpected server response")
  }
  await approveRegistrationRequest(request.id)
}

// ── API clients (V13) ───────────────────────────────────────────────

export function fetchClients(): Promise<ClientRow[]> {
  return apiFetch<unknown>("/auth/clients").then((data) =>
    parseOrThrow(z.array(ClientRowSchema), data),
  )
}

export async function createClient(
  name: string,
): Promise<{ client: ClientRow; apiKey: string }> {
  const data = await apiFetch<unknown>("/auth/clients", {
    method: "POST",
    body: { name },
  })
  const parsed = parseOrThrow(CreateClientResponseSchema, data)
  return { client: parsed.client, apiKey: parsed.api_key }
}

export function deleteClient(id: number): Promise<void> {
  return apiFetch<unknown>(`/auth/clients/${id}`, { method: "DELETE" }).then((data) => {
    parseOrThrow(StatusSchema, data)
  })
}
