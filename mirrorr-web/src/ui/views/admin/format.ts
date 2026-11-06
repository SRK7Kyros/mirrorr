/** Human names for the server's role enum — a row never prints `admin`. */
const ROLE_LABEL: Record<string, string> = {
  admin: "Administrator",
  user: "Member",
  "api-client": "API client",
}

export function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role
}

/** "1 user" / "3 users" — the one place the toolbar and StatLine pluralise. */
export function countLabel(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : plural}`
}

/** The registration queue's own key: no factory exists for an admin-only list. */
export const REGISTRATION_REQUESTS_KEY = ["auth", "registration-requests"] as const
