import { useNavigate, useRouterState } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import type { JSX, ReactNode } from "react"
import { Drawer, NavItem, IconSettings, IconProfiles, IconImportExport } from "@/components/ui"
import { API_CLIENT_POLL_LABEL, isApiClientPrincipal, useAuthState, useRealtimeState } from "@/shells/a/chrome-data"
import {
  Backdrop,
  BackdropNote,
  BackdropSwitch,
  Breadcrumb,
  MORE_SURFACE_IDS,
  NAV_GLYPH,
  NAV_SURFACES,
  Notifications,
  RailFooter,
  StagePlaceholder,
  TabBar,
  TallyBand,
  TopbarAccount,
  WordmarkPlate,
  navSurfaceLabel,
  titleForPath,
} from "@/shells/a/parts"
import type { ConnectionChipProps, TallyPlate } from "@/shells/a/parts"

/* ───────────────────────────────────────────────────────────────────────────
 * Shell A — "Safe" (§3). Light cold-daylight glass control deck.
 *
 * Anatomy, desktop ≥1280px: fixed backdrop (z0) → floating 240px acrylic nav
 * rail (z40) / opaque dark topbar (z30) / stage (z10, THE vertical scroll
 * owner) → tally band (z10) → overlays (primitives).
 *
 * Scroll law (§3/§1.2): this shell writes no `overflow` on a flex/grid child
 * that must shrink, and no `100vh` anywhere; the `stage` is the only vertical
 * scroller and the rail is the only other one, and only overflows on short
 * viewports. `100dvh` appears in shell-a.css only.
 * ─────────────────────────────────────────────────────────────────────────── */

/** Temporary chrome fixture (§3 content); replaced when the orchestrator wires data. */
function useTallyPlates(): ReadonlyArray<TallyPlate> {
  return useMemo(
    () => [
      {
        id: "sessions",
        span: 2,
        eyebrow: "Sessions",
        headline: "Live activity",
        chips: [
          { status: "active", title: "Running" },
          { status: "recording", title: "Recording" },
        ],
        stats: [
          { label: "Active", value: "—" },
          { label: "Recording", value: "—" },
          { label: "Next start", value: "—" },
        ],
      },
      {
        id: "queue",
        span: 3,
        eyebrow: "Autoruns",
        headline: "Queue",
        chips: [{ status: "scheduled", title: "Scheduled" }],
        stats: [
          { label: "Queued", value: "—" },
          { label: "Next run", value: "—" },
        ],
        bare: true,
      },
      {
        id: "vault",
        span: 2,
        eyebrow: "Recordings",
        headline: "Vault",
        stats: [
          { label: "Stored", value: "—" },
          { label: "Remuxing", value: "0" },
          { label: "Free", value: "—" },
        ],
      },
    ],
    [],
  )
}

/** §3 WL chip states: Live / Polling 10s / Offline. */
function connectionChipState(state: {
  readonly events: string
  readonly notifications: string
  readonly pollingFallback: boolean
}): { readonly label: string; readonly tone: ConnectionChipProps["tone"] } {
  const open = state.events === "open" || state.notifications === "open"
  if (open && !state.pollingFallback) return { label: "Live", tone: "live" }
  if (state.pollingFallback || state.events === "polling") return { label: "Polling 10s", tone: "polling" }
  return { label: "Offline", tone: "offline" }
}

export function ShellA({ children }: { readonly children: ReactNode }): JSX.Element {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const auth = useAuthState()
  const realtime = useRealtimeState()
  const [moreOpen, setMoreOpen] = useState(false)

  const title = titleForPath(pathname)
  const plates = useTallyPlates()
  const connection = connectionChipState(realtime)
  const isApiClient = isApiClientPrincipal(auth.auth)

  /* The orchestrator owns variant/backdrop selection; the shell keeps a
   * togglable prop-free default so the state is reachable in isolation. */
  const [backdropEnabled, setBackdropEnabled] = useState(true)
  /* §2.2 fixture: no live still / poster frame yet → the licensed mesh. */
  const mediaUrl: string | undefined = undefined

  const activeId = NAV_SURFACES.find(
    (surface) => pathname === surface.href || pathname.startsWith(`${surface.href}/`),
  )?.id

  return (
    <div className="shell-a" data-backdrop={backdropEnabled ? "on" : "off"} data-api-client={isApiClient ? "true" : undefined}>
      <a className="skip-link" href="#shell-a-stage">
        Skip to content
      </a>

      <div className="shell-a__backdrop" aria-hidden="true">
        {backdropEnabled ? <Backdrop mediaUrl={mediaUrl} /> : null}
      </div>

      <nav className="nav-rail acrylic acrylic--nav" aria-label="Primary">
        <WordmarkPlate />
        <ul className="shell-a__nav-list">
          {NAV_SURFACES.map((surface) => {
            const Glyph = NAV_GLYPH[surface.id]
            return (
              <li key={surface.id}>
                <NavItem
                  label={surface.label}
                  icon={<Glyph size={20} />}
                  active={activeId === surface.id}
                  href={surface.href}
                  className="shell-a__nav-item"
                  onClick={() => {
                    void navigate({ to: surface.href })
                  }}
                />
              </li>
            )
          })}
        </ul>
        <RailFooter connectionLabel={connection.label} connectionTone={connection.tone} />
      </nav>

      <header className="shell-a__topbar chrome-dark">
        <div className="shell-a__topbar-head">
          <Breadcrumb title={title} />
          <h1 className="shell-a__title">{title}</h1>
        </div>
        <div className="shell-a__topbar-actions">
          <BackdropSwitch enabled={backdropEnabled} onToggle={() => setBackdropEnabled((value) => !value)} />
          <button type="button" className="shell-a__cta">
            New session
          </button>
          <Notifications />
          <TopbarAccount />
        </div>
      </header>

      <main className="stage" id="shell-a-stage" tabIndex={-1}>
        <div className="shell-a__tally">
          <TallyBand plates={plates} />
        </div>
        <div className="shell-a__content">{children ?? <StagePlaceholder title={title} />}</div>
      </main>

      <TabBar
        activeId={activeId ?? ""}
        onNavigate={(href) => {
          void navigate({ to: href })
        }}
        onMore={() => setMoreOpen(true)}
      />

      <Drawer
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        title="More"
        side="right"
        footer={<button type="button" className="shell-a__cta" onClick={() => setMoreOpen(false)}>Done</button>}
      >
        <ul className="shell-a__more-list">
          {MORE_SURFACE_IDS.map((id) => {
            const Glyph = id === "profiles" ? IconProfiles : id === "import-export" ? IconImportExport : IconSettings
            return (
              <li key={id}>
                <NavItem
                  label={navSurfaceLabel(id)}
                  icon={<Glyph size={20} />}
                  onClick={() => {
                    setMoreOpen(false)
                    if (id === "profiles") void navigate({ to: "/profiles" })
                    else if (id === "import-export") void navigate({ to: "/import-export" })
                    else void navigate({ to: "/settings" })
                  }}
                />
              </li>
            )
          })}
        </ul>
        {isApiClient ? <p className="api-note shell-a__api-note">{API_CLIENT_POLL_LABEL}</p> : null}
      </Drawer>

      <div className="shell-a__notes">
        <BackdropNote enabled={backdropEnabled} onToggle={() => setBackdropEnabled(true)} />
      </div>
    </div>
  )
}
