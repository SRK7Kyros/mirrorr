import type { AuthResponse } from "@/api/schemas"

/**
 * One reading of the authenticated principal for the chrome. A user principal
 * carries a role; an API-client principal has no user and no notifications.
 */
export interface Identity {
  readonly name: string
  readonly role: string
  readonly isApiClient: boolean
  readonly isAdmin: boolean
}

export function describeIdentity(auth: AuthResponse | null): Identity {
  const user = auth?.user ?? null
  if (user !== null) {
    return {
      name: user.display_name !== "" ? user.display_name : user.username,
      role: user.role,
      isApiClient: false,
      isAdmin: user.role === "admin",
    }
  }
  const client = auth?.client ?? null
  if (client !== null) {
    return { name: client.name, role: "api client", isApiClient: true, isAdmin: false }
  }
  return { name: "Account", role: "", isApiClient: false, isAdmin: false }
}
