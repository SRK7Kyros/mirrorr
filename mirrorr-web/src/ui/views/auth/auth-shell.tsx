import type { ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import { IconDisc, Panel, PanelBody } from "@/ui/components"

/**
 * The one frame the two public pages share: wordmark above a single panel, the
 * alternative door below it. Both pages are page-level forms, so nothing here
 * traps focus — the shell only owns spacing, the mark and the width.
 */
export function AuthShell({
  children,
  footer,
}: {
  readonly children: ReactNode
  readonly footer: ReactNode
}) {
  return (
    <div className="grid min-h-dvh place-items-center bg-canvas px-4 pt-6 pb-6">
      <div className="flex w-full max-w-[400px] flex-col gap-5">
        <div className="mb-1 flex items-center justify-center gap-3">
          <span className="grid size-7 shrink-0 place-content-center rounded-sm text-brand-ink [background:linear-gradient(140deg,var(--accent)_0%,var(--accent-press)_100%)]">
            <IconDisc size={18} />
          </span>
          <div>
            <div className="text-lg font-bold tracking-[-0.02em]">Mirrorr</div>
            <div className="text-xs tracking-[0.08em] text-ink-muted uppercase [font-family:var(--font-mono)]">
              Control Room
            </div>
          </div>
        </div>
        <Panel>
          <PanelBody>{children}</PanelBody>
        </Panel>
        <div className="flex min-h-11 flex-wrap items-center justify-center gap-1 text-base text-ink-muted">
          {footer}
        </div>
      </div>
    </div>
  )
}

/** Footer link with a real 44 px target — the old auth links were 16 px tall. */
export function AuthLink({ to, children }: { readonly to: "/login" | "/register"; readonly children: ReactNode }) {
  return (
    <Link className="tab-stop inline-flex min-h-11 items-center px-2 font-medium text-brand hover:underline" to={to}>
      {children}
    </Link>
  )
}

/** Reserved inline error line: it exists before the first failure, so nothing reflows. */
export function AuthError({ message }: { readonly message: string | null }) {
  return (
    <p role="alert" className="min-h-5 text-sm text-danger">
      {message ?? ""}
    </p>
  )
}
