/**
 * A single V7 recording card (spec L303-L322): identity, engine/resolver/
 * profile names, duration/size/created metadata and the link-out-only footer.
 * `content_url` is a static file path, never embedded (contract §13.11.5), so
 * the Open action is an anchor and the empty case renders the muted hint.
 */
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/Button"
import { FOCUS_RING } from "@/components/ui/focus-ring"
import { formatBytes, formatDuration, formatRelativeTime } from "@/lib/format"
import { recordingHasMedia, type Recording } from "@/lib/schemas/recordings"

export interface RecordingCardProps {
  readonly recording: Recording
  readonly highlighted: boolean
  readonly pending: boolean
  readonly onOpen: (recording: Recording) => void
  readonly onCopy: (recording: Recording) => void
  readonly onDelete: (recording: Recording) => void
}

export function RecordingCard({
  recording,
  highlighted,
  pending,
  onOpen,
  onCopy,
  onDelete,
}: RecordingCardProps) {
  const duration = recording.duration_seconds ?? null
  const size = recording.size_bytes ?? null
  const created = recording.created_at == null ? null : formatRelativeTime(recording.created_at, new Date())

  return (
    <article
      data-testid={`recording-card-${recording.id}`}
      data-entity-id={recording.id}
      data-highlighted={highlighted ? "true" : undefined}
      className={`flex flex-col gap-3 rounded-surface border bg-bg-raised p-4 transition-shadow ${
        highlighted ? "border-accent ring-2 ring-accent" : "border-border"
      }`}
    >
      <div className="flex flex-col gap-0.5">
        <h2 className="text-body font-medium text-text-primary">{recording.user_friendly_name}</h2>
        <p className="font-mono text-small text-text-muted">{recording.snake_case_name}</p>
      </div>

      <dl className="flex flex-col gap-1 text-small">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-text-muted">Engine</dt>
          <dd className="text-text-secondary">{recording.engine_name ?? "—"}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-text-muted">Resolver</dt>
          <dd className="text-text-secondary">{recording.resolver_name ?? "—"}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-text-muted">Profile</dt>
          <dd className="text-text-secondary">{recording.profile_name ?? "—"}</dd>
        </div>
      </dl>

      <p className="flex items-center gap-2 text-small text-text-muted">
        {duration === null ? null : <span>{formatDuration(duration)}</span>}
        {size === null ? null : <span>{formatBytes(size)}</span>}
        {created === null ? null : <span title={created.title}>{created.text}</span>}
      </p>

      <div className="mt-auto flex items-center gap-2">
        {recordingHasMedia(recording) ? (
          <>
            <a
              href={recording.content_url ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => {
                event.preventDefault()
                onOpen(recording)
              }}
              className={`inline-flex h-11 items-center justify-center rounded-control border border-border bg-bg-overlay px-4 text-body font-medium text-text-primary hover:bg-bg-inset ${FOCUS_RING}`}
            >
              Open
            </a>
            <Button size="sm" variant="secondary" onClick={() => onCopy(recording)} disabled={pending}>
              Copy link
            </Button>
          </>
        ) : (
          <p className="text-small text-text-muted">Media not served on this install</p>
        )}
        <Button
          size="sm"
          variant="ghost"
          icon={Trash2}
          aria-label={`Delete ${recording.user_friendly_name}`}
          onClick={() => onDelete(recording)}
          disabled={pending}
          className="ml-auto"
        />
      </div>
    </article>
  )
}
