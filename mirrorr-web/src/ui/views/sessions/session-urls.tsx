import { useState } from "react"
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
    const url = entry.url ?? Object.values(entry)[0] ?? ""
    if (url === "") continue
    out.push({ label: entry.label ?? Object.keys(entry)[0] ?? "URL", url })
  }
  return out
}

/** The HLS playlist a preview can play, if the session published one. */
export function pickPlayableUrl(urls: readonly SessionUrl[]): string | null {
  return urls.find((entry) => /\.m3u8$/i.test(entry.url.split(/[?#]/)[0] ?? ""))?.url ?? null
}

function CopyButton({ value, label }: { readonly value: string; readonly label: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      // Clipboard unavailable (insecure context or denied) — the link still opens.
    }
  }

  return (
    <button type="button" className="url-copy" aria-label={`Copy ${label} URL`} onClick={() => void copy()}>
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
    <ul className={cn("url-list", className)}>
      {urls.map((entry) => (
        <li key={entry.label} className="url-list-item">
          <span className="url-list-label">{entry.label}</span>
          <a
            className="url-list-value mono text-truncate"
            href={entry.url}
            target="_blank"
            rel="noreferrer"
            title={entry.url}
          >
            {entry.url}
            <IconExternal size={12} />
          </a>
          <CopyButton value={entry.url} label={entry.label} />
        </li>
      ))}
    </ul>
  )
}
