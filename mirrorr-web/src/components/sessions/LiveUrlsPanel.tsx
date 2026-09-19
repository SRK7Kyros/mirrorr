/**
 * V4 — the Live URLs panel.
 *
 * Contract:
 * - `docs/web-frontend-spec.md` L267-L277 — when `session_urls` is non-empty,
 *   render labelled links (M3U8 / HTML / Outplayer) with copy buttons and an
 *   "Open in new tab" affordance.
 * - `docs/web-frontend-spec.md` L15 / L208 — an empty `session_urls` is normal,
 *   not an error: render the muted "Live URLs unavailable — the operator must
 *   set `web_url` on the server" copy with no spinner and no player.
 */
import { Copy, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/Button"
import { FOCUS_RING } from "@/components/ui/focus-ring"
import { showToast } from "@/lib/toast"

/** One `session_urls` entry, e.g. `{m3u8: "https://…"}`. */
export type SessionUrlEntry = Readonly<Record<string, string>>

export interface LiveUrlsPanelProps {
  urls: readonly SessionUrlEntry[] | null | undefined
}

const URL_LABELS: Readonly<Record<string, string>> = {
  m3u8: "M3U8",
  html: "HTML",
  outplayer: "Outplayer",
}

interface UrlRow {
  readonly key: string
  readonly label: string
  readonly href: string
}

function toRows(urls: readonly SessionUrlEntry[]): UrlRow[] {
  const rows: UrlRow[] = []
  urls.forEach((entry, index) => {
    for (const [key, href] of Object.entries(entry)) {
      if (typeof href !== "string" || href.length === 0) continue
      rows.push({ key: `${key}-${index}`, label: URL_LABELS[key] ?? key, href })
    }
  })
  return rows
}

export function LiveUrlsPanel({ urls }: LiveUrlsPanelProps) {
  const rows = toRows(urls ?? [])

  return (
    <section
      data-testid="live-urls-panel"
      data-empty={rows.length === 0 ? "true" : "false"}
      className="rounded-surface border border-border bg-bg-raised p-4"
    >
      <h2 className="text-label font-medium text-text-secondary">Live URLs</h2>

      {rows.length === 0 ? (
        <p data-testid="live-urls-empty" className="mt-2 text-small text-text-muted">
          Live URLs unavailable — the operator must set <code className="font-mono">web_url</code> on the
          server
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {rows.map((row) => (
            <li
              key={row.key}
              data-testid="live-url-row"
              className="flex flex-wrap items-center gap-2 rounded-control border border-border bg-bg-inset px-3 py-2"
            >
              <span className="text-small font-medium text-text-secondary">{row.label}</span>
              <a
                data-testid="live-url-link"
                href={row.href}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open ${row.label} in a new tab`}
                className={`ml-auto inline-flex items-center gap-1 rounded-control px-2 py-1 text-small text-accent hover:underline ${FOCUS_RING}`}
              >
                Open in new tab
                <ExternalLink aria-hidden="true" className="size-[var(--icon-row)]" />
              </a>
              <Button
                variant="secondary"
                size="sm"
                icon={Copy}
                aria-label={`Copy ${row.label} URL`}
                data-testid="live-url-copy"
                onClick={() => {
                  void navigator.clipboard.writeText(row.href).then(
                    () => showToast(`${row.label} URL copied`, "info"),
                    () => showToast("Clipboard unavailable"),
                  )
                }}
              >
                Copy
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
