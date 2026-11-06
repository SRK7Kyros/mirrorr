import type { ReactNode } from "react"
import { QueryState, Skeleton, TabPanel, type QueryLike } from "@/ui/components"

/**
 * The preset editor's presentational parts: the numbered block, the kind panel,
 * the catalog gate and the body clearance that keeps the footer off the last
 * field on a phone (`PRE-07`).
 *
 * Nothing here holds state or talks to the API — the dialog beside it owns
 * both — so these can be read as pure layout.
 */

export interface FormBlockProps {
  /** Short index shown in the accent disc — the order the form is read in. */
  readonly step: string
  readonly title: string
  /** One-line note on the right of the header (what this part decides). */
  readonly hint?: string
  readonly children: ReactNode
}

/** One numbered part of a form, so the parts never blur into one another. */
export function FormBlock({ step, title, hint, children }: FormBlockProps) {
  return (
    <section className="flex flex-col gap-3 rounded-md border border-line-subtle bg-surface-1 p-4 max-sm:p-3">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-[var(--accent-line)] bg-[var(--accent-dim)] text-xs font-semibold tabular-nums text-brand"
          aria-hidden="true"
        >
          {step}
        </span>
        <h3 className="text-sm font-semibold tracking-wider text-ink uppercase">{title}</h3>
        {hint !== undefined ? <span className="ms-auto text-sm text-ink-dim">{hint}</span> : null}
      </header>
      {children}
    </section>
  )
}

/** The kind tab panel when the switcher is on screen, a plain group when not. */
export function FormPanel({
  switcher,
  active,
  children,
}: {
  readonly switcher: boolean
  readonly active: "profile" | "source"
  readonly children: ReactNode
}) {
  if (!switcher) return <div className={BODY_CLASS}>{children}</div>
  return (
    <TabPanel panelId="preset-kind" active={active} className={BODY_CLASS}>
      {children}
    </TabPanel>
  )
}

/**
 * The dialog body is this element's parent, and it is the thing that scrolls.
 * A control brought into view by focus lands flush against the bottom edge —
 * which on a phone is the footer's top border, so it reads as "the footer is
 * covering the last field". `scroll-margin-bottom` is the target-side twin of
 * `scroll-padding-bottom`: it makes the browser leave that much room below a
 * focused control, and `BodyTail` below provides the headroom to leave.
 */
const BODY_CLASS =
  "flex flex-col gap-4 [&_input]:scroll-mb-20 [&_select]:scroll-mb-20 [&_textarea]:scroll-mb-20"

/** Headroom at the end of the body, one footer deep — only where space is tight. */
export function BodyTail() {
  return <div aria-hidden="true" className="hidden h-16 shrink-0 max-sm:block" />
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

/**
 * A select fed by a lookup catalog — loading, then error with its own Retry,
 * then empty prose, then the control (`CMP-08`).
 *
 * The empty branch is explicit because "this account has none" and "the list
 * did not load" are different sentences, and the old form printed the first
 * for both.
 */
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
