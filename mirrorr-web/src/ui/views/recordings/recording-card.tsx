import { useEffect, useState, type MouseEvent } from "react";
import { probeMediaUrl } from "@/api";
import type { Recording } from "@/api/schemas";
import { formatBytes, formatDateTime, formatDuration } from "@/api/time";
import {
  Button,
  IconButton,
  IconCopy,
  IconExternal,
  IconTrash,
  Tag,
  toast,
} from "@/ui/components";
import { SessionPreviewPlayer } from "@/ui/views/sessions/session-preview-player";
import { SessionUrls } from "@/ui/views/sessions/session-urls";

/** Descendants that own their own click — a card click must not hijack them. */
const INTERACTIVE = "a, button, input, label, [role='menu'], [role='menuitem']";

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
    <div className="row" style={{ gap: "var(--s-2)" }}>
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
}: {
  readonly recording: Recording;
  readonly onDelete: (recording: Recording) => void;
  readonly highlightRef: (element: HTMLElement | null) => void;
}) {
  const [hovering, setHovering] = useState(false);
  const served = useMediaServed(recording);
  const playable = served === false ? null : recording.content_url;

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
      className="session-card"
      onClick={openRecording}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocusCapture={() => setHovering(true)}
      onBlurCapture={() => setHovering(false)}
    >
      <SessionPreviewPlayer
        src={playable}
        loop
        hovering={hovering}
        label={`recording #${recording.id}`}
      >
        <div className="session-card-overlay">
          <Tag>{recording.snake_case_name}</Tag>
          <span className="session-card-flag tnum">
            {formatDuration(recording.duration_seconds)}
          </span>
        </div>
      </SessionPreviewPlayer>

      <div className="session-card-body">
        <div className="session-card-head">
          <a
            className="session-card-title text-truncate"
            href={recording.content_url}
            target="_blank"
            rel="noreferrer"
            title={recording.user_friendly_name}
          >
            {recording.user_friendly_name}
          </a>
          <span className="session-card-id mono tnum text-dim">
            #{recording.id}
          </span>
          <span className="session-card-spacer" />
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

        <div className="session-card-source">
          {recording.resolver_name}
          <span className="text-dim" aria-hidden="true">
            {" → "}
          </span>
          {recording.engine_name}
        </div>

        <div className="session-card-meta text-dim">
          <span className="text-truncate">{recording.profile_name}</span>
          <span className="tnum">{formatBytes(recording.size_bytes)}</span>
          <span>{formatDateTime(recording.created_at)}</span>
        </div>

        {served === false ? <MediaHint recording={recording} /> : null}

        <SessionUrls
          urls={[{ label: "File", url: recording.content_url }]}
          className="session-card-urls"
        />
      </div>
    </article>
  );
}
