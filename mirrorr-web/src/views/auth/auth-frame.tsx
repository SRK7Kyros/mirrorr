import type { ReactNode } from "react"
import { Skeleton } from "@/components/ui/Skeleton"

/**
 * Auth composition (§5.1/§5.2). Auth is the one surface licensed to sit on a
 * mostly-empty backdrop, so this frame owns the backdrop layer + glass wordmark
 * plate + the opaque form panel; the shells own every other page's chrome.
 *
 * Shell A reading: backdrop + glass wordmark plate (0.64/16) + opaque form
 * panel left-of-center, no rail/topbar.
 * Shell B reading: the right region is the monitor-wall slot — it shows the
 * licensed mesh with a `label-caps` "backdrop — no sources yet" note.
 */

/** Rate-limit windows from the API (§13.10.7: login 10/60s, register 5/60s). */
export const LOGIN_LOCK_MS = 60_000
export const REGISTER_LOCK_MS = 60_000

export const RATE_LIMIT_TITLE = "Too many attempts — try again in a minute"

export function AuthBackdrop() {
  return (
    <div className="backdrop-layer" aria-hidden="true">
      <div className="backdrop-scrim" />
      <div className="backdrop-media backdrop-mesh" />
    </div>
  )
}

export interface AuthFrameProps {
  readonly title: string
  readonly children: ReactNode
  readonly footnote?: ReactNode
}

export function AuthFrame({ title, children, footnote }: AuthFrameProps) {
  return (
    <>
      <AuthBackdrop />
      <div className="auth-root">
        <div className="auth-plate acrylic acrylic--card acrylic--r-sm">
          <span className="auth-plate__mark" aria-hidden="true" />
          <span className="t-label-caps">Mirrorr</span>
        </div>
        <main className="auth-grid">
          <section className="auth-panel panel opaque" aria-labelledby="auth-panel-title">
            <h1 id="auth-panel-title" className="auth-panel__title t-h2">
              {title}
            </h1>
            {children}
            {footnote !== undefined ? <div className="auth-footnote">{footnote}</div> : null}
          </section>
          <aside className="auth-aside" aria-hidden="true">
            <p className="auth-aside__note t-label-caps">backdrop — no sources yet</p>
          </aside>
        </main>
      </div>
    </>
  )
}

/** Boot splash: wordmark plate + shape-matching skeleton form (§5.1 Loading). */
export function AuthSplash({ title }: { title: string }) {
  return (
    <AuthFrame title={title}>
      <div className="auth-splash" role="status" aria-label="Loading console">
        <Skeleton geometry="row" />
        <Skeleton geometry="row" />
        <Skeleton geometry="row" />
      </div>
    </AuthFrame>
  )
}
