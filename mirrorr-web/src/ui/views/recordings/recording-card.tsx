import { useEffect, useState, type MouseEvent } from "react";
import { probeMediaUrl } from "@/api";
import type { Recording } from "@/api/schemas";
import { formatBytes, formatDateTime, formatDuration } from "@/api/time";
import {
  Button,
  Checkbox,
  IconButton,
  IconCopy,
  IconExternal,
  IconTrash,
  Tag,
  toast,
} from "@/ui/components";
import { AccessButton } from "@/ui/views/shared/resource-access-slot";
import { SessionPreviewPlayer } from "@/ui/views/sessions/session-preview-player";
import { SessionUrls } from "@/ui/views/sessions/session-urls";

/**
 * Descendants that own their own click — a card click must not hijack them.
 * `[data-card-ignore]` is the preview player, never a navigation target.
 */
const INTERACTIVE = "a, button, input, label, [role='menu'], [role='menuitem'], [data-card-ignore]";

/** Prefer the server's `media_served`; fall back to one cached HEAD probe. */
function useMediaServed(recording: Recording): boolean | null {
  const [served, setServed] = useState<boolean | null>(
    recording.media_served ?? null,
  );
  useEffect(() => {
    if (served !== null) return;
    let active = true;
    void probeMediaUrl(recording.content_url).then((ok) => {
      if (active) setServed(ok);
    });
    return () => {
      active = false;
    };
  }, [recording.content_url, served]);
  return served;
}

async function copyLink(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Link copied");
  } catch {
    toast.error("Copy failed", "Select the link and copy it manually.");
  }
}

function MediaHint({ recording }: { readonly recording: Recording }) {
  return (
    <div className="flex items-center gap-3" style={{ gap: "var(--s-2)" }}>
      <span className="text-dim" style={{ fontSize: "var(--fs-xs)" }}>
        Media not served on this install — copy link instead
      </span>
      <Button
        size="sm"
        variant="ghost"
        icon={<IconCopy size={13} />}
        onClick={() => void copyLink(recording.content_url)}
      >
        Copy link
      </Button>
    </div>
  );
}

/**
 * One finished capture as a media card: a hover/tap preview over the recorded
 * file, its metadata and the served URL. Clicking the card opens the file; a
 * pointer-less device uses the play button to preview.
 */
export function RecordingCard({
  recording,
  onDelete,
  highlightRef,
  selected = false,
  onToggle,
}: {
  readonly recording: Recording;
  readonly onDelete: (recording: Recording) => void;
  readonly highlightRef: (element: HTMLElement | null) => void;
  readonly selected?: boolean;
  readonly onToggle?: (id: number) => void;
}) {
  const [hovering, setHovering] = useState(false);
  const served = useMediaServed(recording);
  const playable = served === true ? recording.content_url : null;

  function openRecording(event: MouseEvent<HTMLElement>) {
    if (served === false) return;
    if ((event.target as HTMLElement).closest(INTERACTIVE) !== null) return;
    if (window.getSelection()?.toString() !== "") return;
    window.open(recording.content_url, "_blank", "noopener,noreferrer");
  }

  return (
    <article
      ref={highlightRef}
      data-id={recording.id}
      data-selected={selected}
      className="session-card flex flex-col border border-line rounded-lg bg-surface-2 overflow-hidden cursor-pointer transition-[border-color,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:border-line-strong hover:shadow-elev-md data-[selected=true]:border-[color:var(--accent-line)] data-[selected=true]:shadow-[inset_2px_0_0_var(--accent)]"
      onClick={openRecording}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocusCapture={() => setHovering(true)}
      onBlurCapture={() => setHovering(false)}
    >
      <SessionPreviewPlayer
        src={playable}
        htmlUrl={null}
        loop
        hovering={hovering}
        label={`recording #${recording.id}`}
      >
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 px-3 py-2 [background-image:linear-gradient(to_top,var(--overlay-scrim),transparent)] pointer-events-none">
          <Tag>{recording.snake_case_name}</Tag>
          <span className="tnum text-2xs font-semibold tracking-[0.06em] uppercase text-ink">
            {formatDuration(recording.duration_seconds)}
          </span>
        </div>
      </SessionPreviewPlayer>

      <div className="flex flex-col gap-3 px-4 pt-3 pb-4">
        <div className="flex items-center gap-2">
          <a
            className="font-semibold text-ink min-w-0 text-truncate"
            href={recording.content_url}
            target="_blank"
            rel="noreferrer"
            title={recording.user_friendly_name}
          >
            {recording.user_friendly_name}
          </a>
          <span className="shrink-0 mono tnum text-dim">
            #{recording.id}
          </span>
          <span className="flex-1" />
          {onToggle === undefined ? null : (
            <Checkbox
              aria-label={`Select ${recording.user_friendly_name}`}
              checked={selected}
              onChange={() => onToggle(recording.id)}
            />
          )}
          <AccessButton
            resourceType="recording"
            id={recording.id}
            label={recording.user_friendly_name}
          />
          <IconButton
            label={`Open recording #${recording.id}`}
            icon={<IconExternal size={16} />}
            onClick={() =>
              window.open(
                recording.content_url,
                "_blank",
                "noopener,noreferrer",
              )
            }
          />
          <IconButton
            label={`Delete recording #${recording.id}`}
            icon={<IconTrash size={16} />}
            onClick={() => onDelete(recording)}
          />
        </div>

        <div className="session-card-source text-sm text-ink-muted [overflow-wrap:anywhere]">
          {recording.resolver_name}
          <span className="text-dim" aria-hidden="true">
            {" → "}
          </span>
          {recording.engine_name}
        </div>

        <div className="flex items-baseline justify-between gap-3 text-sm text-dim">
          <span className="text-truncate">{recording.profile_name}</span>
          <span className="tnum">{formatBytes(recording.size_bytes)}</span>
          <span>{formatDateTime(recording.created_at)}</span>
        </div>

        {served === false ? <MediaHint recording={recording} /> : null}

        <SessionUrls urls={[{ label: "File", url: recording.content_url }]} />
      </div>
    </article>
  );
}
