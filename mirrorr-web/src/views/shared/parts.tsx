import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/Button"
import { Dialog } from "@/components/ui/Dialog"
import { Input } from "@/components/ui/Input"
import type { StatusKey } from "@/components/ui/StatusChip"
import { useToast } from "@/components/ui/Toast"
import { getStatusDescriptor } from "@/lib/status-map"
import { formatDuration, parseNaiveUtc } from "@/lib/time"
import type { Session } from "@/lib/schemas"

/** Raw server status → StatusChip props (unknown → neutral + raw title). */
export function statusChipProps(rawStatus: string): { status: StatusKey; title: string } {
  const known = isKnownStatus(rawStatus)
  const descriptor = getStatusDescriptor(rawStatus)
  return known
    ? { status: rawStatus as StatusKey, title: descriptor.label }
    : { status: "unknown", title: rawStatus }
}

export interface LooseNavigateOptions {
  readonly to: string
  readonly params?: Record<string, string>
  readonly search?: Record<string, unknown>
}

export function useLooseNavigate(): (options: LooseNavigateOptions) => void {
  return useNavigate() as unknown as (options: LooseNavigateOptions) => void
}

function buildHref(to: string, params?: Record<string, string>, search?: Record<string, unknown>): string {
  let path = to
  for (const [key, value] of Object.entries(params ?? {})) {
    path = path.replace(`$${key}`, encodeURIComponent(value))
  }
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(search ?? {})) {
    if (value !== undefined && value !== null) query.set(key, String(value))
  }
  const qs = query.toString()
  return qs === "" ? path : `${path}?${qs}`
}

export function RouteLink({
  to,
  params,
  search,
  className,
  children,
}: {
  to: string
  params?: Record<string, string>
  search?: Record<string, unknown>
  className?: string
  children: ReactNode
}) {
  const navigate = useLooseNavigate()
  return (
    <a
      className={className}
      href={buildHref(to, params, search)}
      onClick={(event) => {
        event.preventDefault()
        navigate({ to, params, search })
      }}
    >
      {children}
    </a>
  )
}

function isKnownStatus(rawStatus: string): boolean {
  return (
    rawStatus === "scheduled" ||
    rawStatus === "active" ||
    rawStatus === "recording" ||
    rawStatus === "terminating" ||
    rawStatus === "remuxing" ||
    rawStatus === "finalizing" ||
    rawStatus === "completed" ||
    rawStatus === "failed" ||
    rawStatus === "unknown"
  )
}

/** Session duration seconds: started→ended, or started→now while live. */
export function sessionDurationSeconds(session: Session, now: Date = new Date()): number | null {
  if (session.started_at == null || session.started_at === "") return null
  const start = parseNaiveUtc(session.started_at).getTime()
  const end =
    session.ended_at == null || session.ended_at === ""
      ? now.getTime()
      : parseNaiveUtc(session.ended_at).getTime()
  return Math.max(0, Math.floor((end - start) / 1000))
}

export function sessionDurationLabel(session: Session): string {
  const seconds = sessionDurationSeconds(session)
  return seconds === null ? "—" : formatDuration(seconds)
}

/** 24px icon-only copy control with "Copied" toast (spec: copy + toast). */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // transient textarea fallback (secure contexts only for clipboard API)
      const area = document.createElement("textarea")
      area.value = text
      area.style.position = "fixed"
      area.style.opacity = "0"
      document.body.appendChild(area)
      area.select()
      try {
        document.execCommand("copy")
      } catch {
        toast({ kind: "error", title: "Copy failed" })
        area.remove()
        return
      }
      area.remove()
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
    toast({ kind: "success", title: "Copied" })
  }

  return (
    <button type="button" className="icon-btn" aria-label={label} title={label} onClick={() => void copy()}>
      <span className={copied ? "t-meta copy-flash" : "t-meta"}>{copied ? "Copied" : "Copy"}</span>
    </button>
  )
}

/** Read-only JSON mono well (config panels, schema viewers). */
export function JsonWell({ value, label }: { value: unknown; label?: string }) {
  const text = JSON.stringify(value ?? {}, null, 2)
  return (
    <div className="stack" style={{ gap: "var(--space-xs)" }}>
      {label !== undefined ? <span className="card__legend">{label}</span> : null}
      <pre className="well t-mono">{text}</pre>
    </div>
  )
}

/** Recording column cell: 8px dot + 12px visible text (never hover-only). */
export function RecordingCell({
  recording,
  canRecord,
}: {
  recording: boolean | undefined
  canRecord: boolean
}) {
  const on = recording === true
  return (
    <span className="rec-cell">
      <span className="rec-dot" data-on={on} aria-hidden="true" />
      <span className="t-meta">{canRecord ? (on ? "on" : "off") : "Engine cannot record"}</span>
    </span>
  )
}

/** Engine → Resolver pair with name memo-map resolution. */
export function EngineResolverPair({
  engineName,
  resolverName,
  tag,
}: {
  engineName: string
  resolverName: string
  tag?: { label: string; href: string }
}) {
  return (
    <span className="engine-pair">
      <span className="engine-pair__strong ellipsis" title={`${engineName} → ${resolverName}`}>
        {engineName}
        {" → "}
        {resolverName}
      </span>
      {tag !== undefined ? (
        <a className="t-meta" href={tag.href}>
          {tag.label}
        </a>
      ) : null}
    </span>
  )
}

export interface SaveAsProfileDialogProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly onSave: (name: string) => Promise<void>
  readonly busy?: boolean
  readonly error?: string | null
}

/** Shared name dialog for "Save as profile" (sessions + autoruns). */
export function SaveAsProfileDialog({ open, onClose, onSave, busy = false, error }: SaveAsProfileDialogProps) {
  const [name, setName] = useState("")
  const nameId = "save-as-profile-name"

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Save as profile"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={name.trim() === ""} onClick={() => void onSave(name.trim())}>
            Save
          </Button>
        </>
      }
    >
      <Input
        id={nameId}
        label="Profile name"
        mono
        autoComplete="off"
        spellCheck={false}
        value={name}
        error={error ?? undefined}
        onChange={(event) => setName(event.target.value)}
      />
    </Dialog>
  )
}

/**
 * Fires `onRemoved` when the exact query key is evicted from the cache —
 * how V4/V6 learn `session.deleted`/`autorun.deleted` landed (the event
 * table removes the detail query; it cannot navigate because installEventTable
 * is called without the navigate option).
 */
export function useQueryRemoved(queryKey: readonly unknown[], onRemoved: () => void): void {
  const client = useQueryClient()
  const callback = useRef(onRemoved)
  callback.current = onRemoved
  const signature = JSON.stringify(queryKey)

  useEffect(() => {
    const cache = client.getQueryCache()
    return cache.subscribe((event) => {
      if (event.type !== "removed") return
      if (JSON.stringify(event.query.queryKey) === signature) callback.current()
    })
  }, [client, signature])
}
