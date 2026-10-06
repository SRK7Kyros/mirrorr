import { ApiError } from "@/api/client"

/**
 * One shared error-message extractor for API-backed surfaces. A status of 0
 * means the request never reached the recorder (network or proxy failure).
 */
export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return "Cannot reach the recorder — retry"
    return error.message !== "" ? error.message : fallback
  }
  if (error instanceof Error && error.message !== "") return error.message
  return fallback
}
