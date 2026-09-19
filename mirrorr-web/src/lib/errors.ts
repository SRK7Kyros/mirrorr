/**
 * The typed error model thrown by the HTTP client.
 *
 * Contract:
 * - `docs/web-frontend-spec.md` L116 — non-2xx throws `ApiError {status,
 *   detail, fieldErrors?}`; 422 payloads populate `fieldErrors`.
 * - `docs/general-client-specification.md` §1.3 — uniform error bodies.
 * - `docs/general-client-specification.md` §13.9.5 — 422 `detail[]` field
 *   errors with `loc`, plus the custom `{detail, errors}` shape.
 */

/** Validation messages keyed by form field, derived from a 422 payload. */
export type FieldErrors = Readonly<Record<string, string>>

/**
 * Copy rendered when a 2xx body does not match its declared schema after the
 * single permitted refetch (web frontend spec, Data Layer Contract).
 */
export const UNEXPECTED_RESPONSE_MESSAGE = "Unexpected server response"

/** A non-2xx response. `detail` is a string intended for toasts. */
export class ApiError extends Error {
  readonly kind = "http"
  readonly status: number
  readonly detail: string
  readonly fieldErrors: FieldErrors | undefined

  constructor(init: { status: number; detail: string; fieldErrors?: FieldErrors }) {
    super(init.detail)
    this.name = "ApiError"
    this.status = init.status
    this.detail = init.detail
    this.fieldErrors = init.fieldErrors
  }
}

/**
 * A 2xx response whose body did not match its schema twice in a row (initial
 * answer plus the one refetch). Consumers render `UNEXPECTED_RESPONSE_MESSAGE`.
 */
export class ApiParseError extends Error {
  readonly kind = "parse"
  readonly status: number
  readonly detail = UNEXPECTED_RESPONSE_MESSAGE

  constructor(status: number) {
    super(UNEXPECTED_RESPONSE_MESSAGE)
    this.name = "ApiParseError"
    this.status = status
  }
}

/** Discriminated failure union — switch on `kind` to tell them apart. */
export type ApiFailure = ApiError | ApiParseError

/** Message safe to render for any thrown value. */
export function userMessageForError(error: unknown): string {
  if (error instanceof ApiParseError) return UNEXPECTED_RESPONSE_MESSAGE
  if (error instanceof ApiError) return error.detail
  if (error instanceof Error && error.message.trim().length > 0) return error.message
  return UNEXPECTED_RESPONSE_MESSAGE
}
