import type { ReactNode } from "react"
import { QueryState, Skeleton, type QueryLike } from "@/ui/components"
import type { AutorunMode } from "./autorun-form-dirty"

/**
 * The autorun form's lookup catalogs — profiles, engines, resolvers.
 *
 * The form used to read `useProfiles()`/`useEngines()`/`useResolvers()`, which
 * hand back `data ?? []`. A failed request therefore rendered as an empty
 * `<select>`, and the primary sat disabled with nothing on screen explaining
 * why (`AUT-07`, `F-09`). `CatalogGate` restores the three branches the contract
 * requires — loading skeleton, error with its own Retry, empty prose — and
 * `catalogBlockReason` turns the failure into the sentence printed beside the
 * button, so "disabled" always has a reason.
 */

export const PROFILE_LIST_FAILED = "The profile list did not load — retry it above before saving."
export const ENGINE_LIST_FAILED = "The engine list did not load — retry it above before saving."
export const RESOLVER_LIST_FAILED = "The resolver list did not load — retry it above before saving."

/** Which catalogs failed, and which selection still needs one to arrive. */
export interface CatalogTrouble {
  readonly profileEmpty: boolean
  readonly engineEmpty: boolean
  readonly resolverEmpty: boolean
  readonly profilesFailed: boolean
  readonly enginesFailed: boolean
  readonly resolversFailed: boolean
}

export function catalogBlockReason(mode: AutorunMode, trouble: CatalogTrouble): string | null {
  if (mode === "profile") {
    return trouble.profileEmpty && trouble.profilesFailed ? PROFILE_LIST_FAILED : null
  }
  if (trouble.engineEmpty && trouble.enginesFailed) return ENGINE_LIST_FAILED
  // The resolver field only appears once an engine is picked, so do not name it
  // before it has a home on screen.
  if (!trouble.engineEmpty && trouble.resolverEmpty && trouble.resolversFailed) {
    return RESOLVER_LIST_FAILED
  }
  return null
}

/** The list a failed catalog names, used to keep the two sentences distinct. */
export function catalogLoadingLabel(mode: AutorunMode): string {
  return mode === "profile" ? "Loading profiles" : "Loading engines and resolvers"
}

export interface CatalogGateProps {
  readonly query: QueryLike
  /** Names the list that failed, so "no engines" can never stand in for an error. */
  readonly errorMessage: string
  readonly empty: ReactNode
  readonly isEmpty: boolean
  readonly loadingLabel: string
  readonly children: ReactNode
}

export function CatalogGate({
  query,
  errorMessage,
  empty,
  isEmpty,
  loadingLabel,
  children,
}: CatalogGateProps) {
  return (
    <QueryState
      query={query}
      loading={<CatalogSkeleton label={loadingLabel} />}
      errorMessage={errorMessage}
      isEmpty={isEmpty}
      empty={empty}
    >
      {children}
    </QueryState>
  )
}

/** A field-shaped skeleton, so a loading catalog does not jump the form. */
export function CatalogSkeleton({ label }: { readonly label: string }) {
  return (
    <div className="flex flex-col gap-2" role="status" aria-label={label}>
      <Skeleton width="5rem" height={12} />
      <Skeleton width="100%" height={34} />
    </div>
  )
}

/** "Nothing here yet" for a catalog — actionable, never a dead end. */
export function CatalogEmpty({ children }: { readonly children: ReactNode }) {
  return <p className="text-base text-ink-dim">{children}</p>
}
