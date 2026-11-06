import type { User } from "@/api/schemas/user"

/**
 * Why this account must not be deleted, or `null` when it may be. The server
 * enforces the last-administrator rule alone; offering the action and then
 * failing leaves an admin with a dead menu item and no explanation, so the
 * surface refuses it up front with the same rule (plan §4 SCR-13).
 *
 * Self-deletion is checked first: it is the more immediate consequence, and an
 * admin looking at their own row is not helped by learning about the admin
 * count instead.
 */
export function deleteBlockReason(
  user: Pick<User, "username" | "role">,
  users: readonly Pick<User, "username" | "role">[],
  currentUsername: string | null | undefined,
): string | null {
  if (
    currentUsername !== null &&
    currentUsername !== undefined &&
    user.username === currentUsername
  ) {
    return "you cannot delete your own account"
  }
  if (
    user.role === "admin" &&
    users.filter((candidate) => candidate.role === "admin").length <= 1
  ) {
    return "the last administrator cannot be deleted"
  }
  return null
}
