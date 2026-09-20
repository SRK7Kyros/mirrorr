/**
 * Settings data access — V12 users and V13 API clients.
 *
 * Contract: `docs/general-client-specification.md` §10, §13.7 (wire contract),
 * `docs/web-frontend-spec.md` L375-L393. The user list/delete and the
 * admin-gated register create are the only user surfaces the API has (§10.1 —
 * no client may invent another); the plaintext key from `POST /auth/clients`
 * is returned exactly once (§13.7).
 */
import { z } from "zod"
import { apiFetch } from "@/lib/api"
import {
  apiClientSchema,
  authResponseSchema,
  authUserSchema,
  createdApiClientSchema,
  registrationPendingSchema,
  type ApiClient,
} from "@/lib/schemas/auth"

const usersSchema = z.array(authUserSchema)
const clientsSchema = z.array(apiClientSchema)
const createUserSchema = z.union([authResponseSchema, registrationPendingSchema])

export interface CreateUserInput {
  readonly username: string
  readonly password: string
  readonly displayName?: string
}

export type CreateUserResult =
  | { readonly kind: "created"; readonly user: z.infer<typeof authUserSchema> }
  | { readonly kind: "pending"; readonly username: string }

export interface CreatedApiClient {
  readonly client: ApiClient
  readonly apiKey: string
}

export async function fetchUsers(): Promise<z.infer<typeof usersSchema>> {
  return apiFetch("/auth/users", { schema: usersSchema })
}

/**
 * Admin create (`POST /auth/register`, V12's only user-creation path). The dev
 * server re-issues the auth cookie for the created user, so callers must not
 * rely on an immediate admin refetch — the response is the source of truth.
 */
export async function createUser(input: CreateUserInput): Promise<CreateUserResult> {
  const displayName = input.displayName?.trim()
  const parsed = await apiFetch("/auth/register", {
    method: "POST",
    body: {
      username: input.username,
      password: input.password,
      ...(displayName ? { display_name: displayName } : {}),
    },
    schema: createUserSchema,
  })

  return "user" in parsed
    ? { kind: "created", user: parsed.user }
    : { kind: "pending", username: parsed.username }
}

export async function deleteUser(username: string): Promise<void> {
  await apiFetch(`/auth/users/${encodeURIComponent(username)}`, { method: "DELETE" })
}

export async function fetchClients(): Promise<ApiClient[]> {
  return apiFetch("/auth/clients", { schema: clientsSchema })
}

export async function createApiClient(name: string): Promise<CreatedApiClient> {
  const parsed = await apiFetch("/auth/clients", {
    method: "POST",
    body: { name },
    schema: createdApiClientSchema,
  })
  return { client: parsed.client, apiKey: parsed.api_key }
}

export async function deleteApiClient(id: number): Promise<void> {
  await apiFetch(`/auth/clients/${id}`, { method: "DELETE" })
}
