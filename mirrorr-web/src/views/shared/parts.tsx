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
import { formatDateTime, formatDuration, parseNaiveUtc } from "@/lib/time"
import type { Session } from "@/lib/schemas"

/**
 * Shared, shell-agnostic helpers for the entity surfaces. Exported names and
 * signatures are frozen — other blocks import from here. Markup and class
 * names follow the console token/primitive system (no rejected-build classes).
 */

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

/**
 * §11.3 — the session label is derived, never invented: the tail of the
 * resolver `url` (source) joined with the local start time, falling back to
 * `Session #<id>` when neither is available.
 */
export function sessionSourceTail(session: Session): string | null {
  const config = session.resolver_config as Record<string, unknown> | undefined
  const raw = config?.url ?? config?.web_url ?? config?.source
  if (typeof raw !== "string" || raw.trim() === "") return null
  try {
    const url = new URL(raw)
    const tail = decodeURIComponent(url.pathname.split("/").filter((part) => part !== "").pop() ?? "")
    return tail === "" ? null : tail
  } catch {
    const parts = raw.split(/[\\/]/).filter((part) => part !== "")
    const tail = parts.at(-1)
    return tail === undefined || tail === "" ? null : tail
  }
}

export function sessionTitle(session: Session): string {
  const tail = sessionSourceTail(session)
  const started = session.started_at == null || session.started_at === "" ? null : formatDateTime(session.started_at)
  const parts = [tail, started].filter((part): part is string => part !== null)
  return parts.length === 0 ? `Session #${session.id}` : parts.join(" · ")
}

/** Quiet copy control with a "Copied" confirmation (spec: copy + toast). */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
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
    <button type="button" className="ve-copy" aria-label={label} title={label} onClick={() => void copy()}>
      {copied ? "Copied" : "Copy"}
    </button>
  )
}

/** Read-only JSON mono well (config snapshots, schema viewers). */
export function JsonWell({ value, label }: { value: unknown; label?: string }) {
  const text = JSON.stringify(value ?? {}, null, 2)
  return (
    <div className="ve-stack ve-stack--tight">
      {label !== undefined ? <span className="ve-panel__title">{label}</span> : null}
      <pre className="ve-json">{text}</pre>
    </div>
  )
}

/** Recording column cell: 8px dot + visible text (never hover-only). */
export function RecordingCell({
  recording,
  canRecord,
}: {
  recording: boolean | undefined
  canRecord: boolean
}) {
  const on = recording === true
  return (
    <span className="ve-rec">
      <span className="ve-rec__dot" data-on={on} aria-hidden="true" />
      <span className="ve-note">{canRecord ? (on ? "on" : "off") : "Engine cannot record"}</span>
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
    <span className="ve-pair">
      <span className="ve-pair__name" title={`${engineName} → ${resolverName}`}>
        {engineName}
        {" → "}
        {resolverName}
      </span>
      {tag !== undefined ? (
        <a className="ve-pair__tag" href={tag.href}>
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
        helper="Snapshots this run's current engine, resolver and retry policy."
        error={error ?? undefined}
        onChange={(event) => setName(event.target.value)}
      />
    </Dialog>
  )
}

/**
 * Fires `onRemoved` when the exact query key is evicted from the cache —
 * how a detail view learns `session.deleted`/`autorun.deleted` landed (the
 * event table removes the detail query; it cannot navigate because
 * installEventTable is called without the navigate option).
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
