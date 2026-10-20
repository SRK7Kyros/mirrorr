import { useEffect, useRef, useState } from "react"
import { IconCheck, IconCopy, IconExternal } from "@/ui/components"
import { cn } from "@/ui/lib/cn"

/** A single labelled playback/source URL published by a session. */
export interface SessionUrl {
  readonly label: string
  readonly url: string
}

/**
 * Normalize the loose `session_urls` records (`{label, url}`) into typed pairs.
 * Entries that carry no URL are dropped rather than rendered as dead rows.
 */
export function toSessionUrls(entries: readonly Record<string, string>[] | undefined): SessionUrl[] {
  const out: SessionUrl[] = []
  for (const entry of entries ?? []) {
    const url =
      entry.url ??
      entry.href ??
      Object.entries(entry).find(([key]) => key !== "label" && key !== "type")?.[1] ??
      ""
    if (url === "") continue
    const label =
      entry.label ??
      Object.keys(entry).find((key) => key !== "url" && key !== "href" && key !== "type") ??
      "URL"
    out.push({ label, url })
  }
  return out
}

/** The HLS playlist a preview can play, if the session published one. */
export function pickPlayableUrl(urls: readonly SessionUrl[]): string | null {
  return urls.find((entry) => /\.m3u8$/i.test(entry.url.split(/[?#]/)[0] ?? ""))?.url ?? null
}

/** What the list shows in place of a full URL: every published URL shares the
    deployment's origin, so only the path (and query) carries information. */
export function stripOrigin(url: string): string {
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, "") || url
}

/** The session's `player.html` page, if published — embeds in an iframe. */
export function pickHtmlPlayerUrl(urls: readonly SessionUrl[]): string | null {
  return (
    urls.find((entry) => entry.label.toLowerCase() === "html")?.url ??
    urls.find((entry) => /player\.html/i.test(entry.url.split(/[?#]/)[0] ?? ""))?.url ??
    null
  )
}

function CopyButton({ value, label }: { readonly value: string; readonly label: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1200)
    } catch {
      // Clipboard unavailable (insecure context or denied) — the link still opens.
    }
  }

  return (
    <button
      type="button"
      className="shrink-0 inline-grid place-items-center size-[1.6rem] p-0 border border-transparent rounded-sm bg-transparent text-ink-faint cursor-pointer hover:border-line hover:text-ink hover:bg-surface-hover"
      aria-label={`Copy ${label} URL`}
      onClick={() => void copy()}
    >
      {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
    </button>
  )
}

/**
 * The list of URLs a session publishes — player HTML, HLS playlist, VLC, the
 * session folder. Shared by the session card and the detail view so both read
 * one source.
 */
export function SessionUrls({
  urls,
  className,
}: {
  readonly urls: readonly SessionUrl[]
  readonly className?: string
}) {
  if (urls.length === 0) return null

  return (
    <ul className={cn("url-list flex flex-col gap-1 m-0 p-0 list-none", className)}>
      {urls.map((entry) => (
        <li key={`${entry.label}-${entry.url}`} className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 w-[4.5rem] text-2xs font-semibold tracking-[0.04em] uppercase text-ink-faint">
            {entry.label}
          </span>
          <a
            className="flex-1 inline-flex items-center gap-1 min-w-0 text-2xs text-ink-muted no-underline hover:text-brand mono text-truncate"
            href={entry.url}
            target="_blank"
            rel="noreferrer"
            title={entry.url}
          >
            {stripOrigin(entry.url)}
            <IconExternal size={12} />
          </a>
          <CopyButton value={entry.url} label={entry.label} />
        </li>
      ))}
    </ul>
  )
}
