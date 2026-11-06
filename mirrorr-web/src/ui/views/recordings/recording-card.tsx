import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { probeMediaUrl } from "@/api";
import type { Recording } from "@/api/schemas";
import { formatBytes, formatDuration } from "@/api/time";
import {
  Button,
  buttonClass,
  CardHeaderActions,
  EntityCard,
  IconCopy,
  IconDownload,
  MediaFill,
  RowActions,
  Tag,
  TimeText,
  toast,
} from "@/ui/components";
import { copyText } from "@/ui/lib/clipboard";
import { AccessButton } from "@/ui/views/shared/resource-access-slot";
import { stripOrigin } from "@/ui/views/sessions/session-urls";

/**
 * A finished capture as one `EntityCard` (§2.2a recipe for Recordings):
 * `header` (slug tag · serve state · actions) · `media` (the file's own first
 * frame, or a plate) · `hero` (duration) · `detail` (the internal path) ·
 * `identity` (name · chain · profile · size · created · session) · `footer`
 * (Download · Copy link). Every recording card is the same height, because the
 * media box is always the same 16:9 region and only its fill changes.
 */

const HERO = "text-2xl leading-none font-semibold tabular-nums text-ink";

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

/**
 * Copy never fails silently: a denied clipboard says so, because the user
 * clicked, saw nothing, and has no other way to learn why.
 */
async function copyLink(url: string): Promise<void> {
  try {
    await copyText(url);
    toast.success("Link copied");
  } catch {
    toast.error(
      "Could not copy the link",
      "Clipboard access was denied — select the path and copy it manually.",
    );
  }
}

/** The one 16:9 fill this card can show. An unknown serve state reads as a plate. */
function RecordingMedia({
  recording,
  served,
}: {
  readonly recording: Recording;
  readonly served: boolean | null;
}) {
  if (served === true) {
    return (
      <MediaFill
        fill="cover"
        src={recording.content_url}
        label={`Preview of ${recording.user_friendly_name}`}
      />
    );
  }

  return (
    <MediaFill
      fill="plate"
      label={served === null ? "Checking the file" : "File kept — not served"}
      fields={[
        formatDuration(recording.duration_seconds),
        formatBytes(recording.size_bytes),
        served === null
          ? "Checking whether this install serves the file…"
          : "The server is not serving this file — copy the link instead",
      ]}
    />
  );
}

export function RecordingCard({
  recording,
  onDelete,
  highlightRef,
  selectMode = false,
  selected = false,
  onToggle,
}: {
  readonly recording: Recording;
  readonly onDelete: (recording: Recording) => void;
  readonly highlightRef: (element: HTMLElement | null) => void;
  readonly selectMode?: boolean;
  readonly selected?: boolean;
  readonly onToggle?: (id: number) => void;
}) {
  const served = useMediaServed(recording);
  const nameId = `recording-${recording.id}-name`;

  // A probe that says "not served" is a dead link, not a download: the card
  // opens, and the footer offers a download, only when the file is served.
  const openFile = (): void => {
    window.open(recording.content_url, "_blank", "noopener,noreferrer");
  };

  return (
    <div
      ref={highlightRef}
      data-id={recording.id}
      className="h-full min-w-0 rounded-lg data-[highlight=true]:ring-2 data-[highlight=true]:ring-brand"
    >
      <EntityCard
        labelledBy={nameId}
        selected={selected}
        onOpen={served === true ? openFile : undefined}
        header={
          <>
            <CardHeaderActions
              selectMode={selectMode}
              selected={selected}
              onToggleSelect={() => onToggle?.(recording.id)}
              selectLabel={`Select ${recording.user_friendly_name}`}
            >
              <Tag title="Recording slug">{recording.snake_case_name}</Tag>
              {served === false ? (
                <Tag title="This install is not serving the file">Not served</Tag>
              ) : null}
            </CardHeaderActions>
            <AccessButton
              resourceType="recording"
              id={recording.id}
              label={recording.user_friendly_name}
            />
            <RowActions
              label={`Actions for recording #${recording.id}`}
              actions={[
                {
                  label: `Delete recording #${recording.id}`,
                  danger: true,
                  onSelect: () => onDelete(recording),
                },
              ]}
            />
          </>
        }
        media={<RecordingMedia recording={recording} served={served} />}
        hero={<span className={HERO}>{formatDuration(recording.duration_seconds)}</span>}
        detail={
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 text-2xs font-semibold tracking-[0.04em] uppercase text-dim">
              File
            </span>
            <span
              className="min-w-0 flex-1 truncate font-mono text-2xs text-ink-muted"
              title={recording.content_url}
            >
              {stripOrigin(recording.content_url)}
            </span>
          </div>
        }
        identity={
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-2">
              {served === false ? (
                <span
                  id={nameId}
                  className="inline-flex min-h-6 min-w-0 items-center truncate font-semibold text-ink"
                  title={recording.user_friendly_name}
                >
                  {recording.user_friendly_name}
                </span>
              ) : (
                <a
                  id={nameId}
                  className="inline-flex min-h-6 min-w-0 items-center truncate font-semibold text-ink hover:text-brand"
                  href={recording.content_url}
                  target="_blank"
                  rel="noreferrer"
                  title={recording.user_friendly_name}
                >
                  {recording.user_friendly_name}
                </a>
              )}
              <span className="shrink-0 font-mono text-xs tabular-nums text-dim">
                {`#${recording.id}`}
              </span>
            </div>

            <span className="truncate text-sm text-dim">
              {recording.resolver_name}
              <span aria-hidden="true">{" → "}</span>
              {recording.engine_name}
              <span aria-hidden="true">{" · "}</span>
              {recording.profile_name}
            </span>

            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-dim">
              <span className="shrink-0 whitespace-nowrap tabular-nums">
                {formatBytes(recording.size_bytes)}
              </span>
              <TimeText value={recording.created_at} className="shrink-0 whitespace-nowrap" />
              {recording.session_id === null || recording.session_id === undefined ? null : (
                <Link
                  className="inline-flex min-h-6 shrink-0 items-center whitespace-nowrap hover:text-ink"
                  to="/sessions/$sessionId"
                  params={{ sessionId: String(recording.session_id) }}
                  title={`Open session #${recording.session_id}`}
                >
                  {`Session #${recording.session_id}`}
                </Link>
              )}
            </div>
          </div>
        }
        footer={
          <div className="flex w-full flex-wrap items-center gap-2">
            {served === false ? null : (
              <a
                className={buttonClass({ variant: "outline", size: "sm" })}
                href={recording.content_url}
                download
                target="_blank"
                rel="noreferrer"
                aria-label={`Download recording #${recording.id}`}
              >
                <IconDownload size={15} />
                Download
              </a>
            )}
            <Button
              size="sm"
              variant="ghost"
              icon={<IconCopy size={14} />}
              aria-label={`Copy link for recording #${recording.id}`}
              onClick={() => void copyLink(recording.content_url)}
            >
              Copy link
            </Button>
          </div>
        }
      />
    </div>
  );
}
