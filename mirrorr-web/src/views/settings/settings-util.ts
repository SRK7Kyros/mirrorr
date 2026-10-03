import { ApiError } from "@/lib/api"

/** One shared error-message extractor for the settings surfaces. */
export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return "Cannot reach the recorder — retry"
    return error.message !== "" ? error.message : fallback
  }
  if (error instanceof Error && error.message !== "") return error.message
  return fallback
}

/** Last-admin guard: the list holds exactly one admin. */
export function isLastAdmin(users: readonly { readonly role: string }[]): boolean {
  return users.filter((user) => user.role === "admin").length === 1
}
