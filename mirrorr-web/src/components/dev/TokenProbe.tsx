import { Play, RefreshCw } from "lucide-react"

/**
 * TEMPORARY scaffolding for the token-system step: a token/icon probe that
 * lets the design-token acceptance checks run before the real primitives land.
 * The real StatusChip / Button / Table primitives replace this component.
 *
 * Every value comes from a token declared in src/styles.css; this file holds
 * no literal colour, size or timing. Dark-only, like the rest of v1.
 */
export function TokenProbe() {
  return (
    <section
      aria-label="Design token probe"
      data-testid="token-probe"
      className="flex w-full max-w-sm flex-col items-center gap-4"
    >
      {/* StatusChip sample: 11px/500, 6px dot, 12% alpha fill, 30% alpha border (L76, L106). */}
      <span
        data-testid="status-chip"
        className="inline-flex items-center gap-1.5 rounded-pill border border-ok/30 bg-ok/12 px-2 py-0.5 text-micro font-medium text-ok"
      >
        <span aria-hidden="true" className="size-1.5 rounded-pill bg-ok" />
        Active
      </span>

      {/* Recording pulse: 1.6s ease-in-out infinite, opacity 1 <-> 0.45 (L101). */}
      <span
        data-testid="pulse-dot"
        aria-hidden="true"
        className="animate-pulse-recording size-2 rounded-pill bg-danger"
      />

      {/* Icon-only control: 16px icon, 32px target, aria-label + title tooltip (L103, L479). */}
      <button
        type="button"
        aria-label="Start recording"
        title="Start recording"
        className="inline-flex size-8 items-center justify-center rounded-control border border-border bg-bg-overlay text-text-secondary transition-colors duration-[var(--motion-fast)] ease-out hover:text-text-primary"
      >
        <Play
          aria-hidden="true"
          data-testid="icon-control"
          className="size-[var(--icon-default)]"
          strokeWidth={2}
        />
      </button>

      {/* Row sample: 36px row, 14px row icon, 6px surface radius, mono well (L97, L103). */}
      <div className="flex h-9 w-full items-center gap-2 rounded-surface border border-border bg-bg-raised px-3 text-small text-text-secondary">
        <RefreshCw
          aria-hidden="true"
          data-testid="icon-row"
          className="size-[var(--icon-row)]"
          strokeWidth={2}
        />
        <code data-testid="mono-sample" className="font-mono text-small text-text-muted">
          mirrorr-web
        </code>
      </div>
    </section>
  )
}
