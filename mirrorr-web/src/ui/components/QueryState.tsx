import type { ReactNode } from "react"
import { getErrorMessage } from "@/api/domain/errors"
import { ErrorPanel } from "./Banner"
import { EmptyState } from "./EmptyState"

/**
 * The one query gate. Order is fixed and non-negotiable: loading → error →
 * empty → content. A failed request can never render as "none", which is what
 * happens when a view reads `data ?? []` and never looks at `isError`.
 *
 * `empty` is explicit rather than inferred from an empty array: a list whose
 * search filter matches nothing is a different message from an account with no
 * items, and only the view knows which one it is.
 */
export interface QueryLike {
  readonly isLoading?: boolean
  readonly isError?: boolean
  readonly error?: unknown
  readonly refetch?: () => unknown
}

export interface QueryStateProps {
  readonly query: QueryLike
  /** Skeleton shaped like the real content, so the page does not jump. */
  readonly loading: ReactNode
  /** Rendered when the request succeeded but produced nothing. */
  readonly empty?: ReactNode
  readonly isEmpty?: boolean
  /** Fallback copy when the API error carries no message. */
  readonly errorMessage: string
  readonly onRetry?: () => void
  readonly children: ReactNode
}

export function QueryState({
  query,
  loading,
  empty,
  isEmpty = false,
  errorMessage,
  onRetry,
  children,
}: QueryStateProps) {
  if (query.isLoading === true) return <>{loading}</>

  if (query.isError === true) {
    const retry = onRetry ?? (query.refetch === undefined ? undefined : () => void query.refetch?.())
    return <ErrorPanel message={getErrorMessage(query.error, errorMessage)} onRetry={retry} />
  }

  if (isEmpty && empty !== undefined) return <>{empty}</>

  return <>{children}</>
}

/** Convenience for the common "nothing here yet" card inside a list surface. */
export function QueryEmpty(props: Parameters<typeof EmptyState>[0]) {
  return <EmptyState {...props} />
}
