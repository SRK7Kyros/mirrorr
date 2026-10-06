import { useEffect, useState, type CSSProperties } from "react"
import { Link } from "@tanstack/react-router"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  deleteRecording,
  getErrorMessage,
  probeMediaUrl,
  removeFromInfiniteLists,
  useEntityList,
} from "@/api"
import { fetchRecordingPage } from "@/api/endpoints"
import { queryKeys, queryRoots } from "@/api/query-keys"
import type { Recording } from "@/api/schemas"
import { formatBytes, formatDateTime, formatDuration } from "@/api/time"
import { showingLabel, truncate } from "@/ui/lib/format"
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorPanel,
  IconButton,
  IconCopy,
  IconDisc,
  IconRecordings,
  IconRefresh,
  IconTrash,
  LoadMore,
  Panel,
  PanelBody,
  Segmented,
  Skeleton,
  Table,
  Tag,
  Td,
  Th,
  toast,
  type TabItem,
} from "@/ui/components"
import { useHighlightRef } from "@/ui/hooks"
import { Page } from "@/ui/views/shared/page"

/**
 * Recordings — read + delete only (spec §5.7). Media is always link-only: the
 * poster is a first-frame `<video>` that degrades to a plate plus a copy-link
 * hint when the server reports the file is not served on this install, so the
 * view never renders an autoplaying dead player.
 */

type ViewMode = "list" | "grid"

const POSTER_WIDTH = 104
const POSTER_ASPECT = 0.5625

const VIEW_ITEMS: readonly TabItem<ViewMode>[] = [
  { id: "list", label: "List" },
  { id: "grid", label: "Grid" },
]

async function copyLink(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url)
    toast.success("Link copied")
  } catch {
    toast.error("Copy failed", "Select the link and copy it manually.")
  }
}

/** Prefer the server's `media_served`; fall back to one cached HEAD probe. */
function useMediaServed(recording: Recording): boolean | null {
  const [served, setServed] = useState<boolean | null>(recording.media_served ?? null)
  useEffect(() => {
    if (served !== null) return
    let active = true
    void probeMediaUrl(recording.content_url).then((ok) => {
      if (active) setServed(ok)
    })
    return () => {
      active = false
    }
  }, [recording.content_url, served])
  return served
}

function MediaHint({ recording }: { readonly recording: Recording }) {
  return (
    <div className="row" style={{ gap: "var(--s-2)", marginTop: "var(--s-1)" }}>
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
  )
}

function Poster({
  recording,
  served,
  full = false,
}: {
  readonly recording: Recording
  readonly served: boolean | null
  readonly full?: boolean
}) {
  const [broken, setBroken] = useState(false)
  const box: CSSProperties = {
    ...(full
      ? { width: "100%", aspectRatio: "16 / 9" }
      : { width: POSTER_WIDTH, height: Math.round(POSTER_WIDTH * POSTER_ASPECT) }),
    flex: "none",
    borderRadius: "var(--r-sm)",
    border: "1px solid var(--border-subtle)",
    background: "var(--bg-sunken)",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--text-faint)",
  }
  if (served === false || broken) {
    return (
      <span style={box} title="Media not served on this install">
        <IconDisc size={20} />
      </span>
    )
  }
  return (
    <a
      href={recording.content_url}
      target="_blank"
      rel="noreferrer"
      style={box}
      aria-label={`Open ${recording.user_friendly_name}`}
    >
      <video
        src={recording.content_url}
        muted
        preload="metadata"
        playsInline
        onError={() => setBroken(true)}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    </a>
  )
}

function OpenLink({ recording }: { readonly recording: Recording }) {
  return (
    <a className="btn btn-secondary btn-sm" href={recording.content_url} target="_blank" rel="noreferrer">
      Open
    </a>
  )
}

interface RowProps {
  readonly recording: Recording
  readonly onDelete: (recording: Recording) => void
  readonly highlightRef: (element: HTMLElement | null) => void
}

function RecordingRow({ recording, onDelete, highlightRef }: RowProps) {
  const served = useMediaServed(recording)
  return (
    <tr ref={highlightRef} data-id={recording.id}>
      <Td>
        <Poster recording={recording} served={served} />
      </Td>
      <Td>
        <span className="text-truncate" title={recording.user_friendly_name}>
          {recording.user_friendly_name}
        </span>
        <div style={{ marginTop: "var(--s-1)" }}>
          <Tag>{recording.snake_case_name}</Tag>
        </div>
        {served === false ? <MediaHint recording={recording} /> : null}
      </Td>
      <Td>
        {recording.engine_name}
        <span className="text-dim" aria-hidden="true">
          {" → "}
        </span>
        {recording.resolver_name}
      </Td>
      <Td>{recording.profile_name}</Td>
      <Td num>{formatDuration(recording.duration_seconds)}</Td>
      <Td num>{formatBytes(recording.size_bytes)}</Td>
      <Td>{formatDateTime(recording.created_at)}</Td>
      <Td>
        <span className="mono text-truncate" title={recording.disk_path}>
          {truncate(recording.disk_path, 28)}
        </span>
      </Td>
      <Td actions>
        <div className="row" style={{ gap: "var(--s-2)" }}>
          <OpenLink recording={recording} />
          <IconButton
            label={`Delete recording ${recording.id}`}
            icon={<IconTrash size={15} />}
            onClick={() => onDelete(recording)}
          />
        </div>
      </Td>
    </tr>
  )
}

function RecordingTile({ recording, onDelete, highlightRef }: RowProps) {
  const served = useMediaServed(recording)
  return (
    <Panel>
      <div ref={highlightRef} data-id={recording.id} className="stack-sm" style={{ padding: "var(--s-4)" }}>
        <Poster recording={recording} served={served} full />
        <span className="text-truncate" title={recording.user_friendly_name}>
          {recording.user_friendly_name}
        </span>
        <div>
          <Tag>{recording.snake_case_name}</Tag>
        </div>
        <div className="text-dim" style={{ fontSize: "var(--fs-sm)" }}>
          {formatDuration(recording.duration_seconds)} · {formatBytes(recording.size_bytes)}
        </div>
        <div className="text-dim text-truncate" style={{ fontSize: "var(--fs-sm)" }}>
          {recording.engine_name} → {recording.resolver_name}
        </div>
        <div className="text-dim" style={{ fontSize: "var(--fs-sm)" }}>
          {formatDateTime(recording.created_at)}
        </div>
        {served === false ? <MediaHint recording={recording} /> : null}
        <div className="row" style={{ gap: "var(--s-2)" }}>
          <OpenLink recording={recording} />
          <IconButton
            label={`Delete recording ${recording.id}`}
            icon={<IconTrash size={15} />}
            onClick={() => onDelete(recording)}
          />
        </div>
      </div>
    </Panel>
  )
}

function RecordingsSkeleton() {
  return (
    <div className="stack-sm" aria-busy="true" aria-label="Loading recordings">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="row" style={{ gap: "var(--s-4)" }}>
          <Skeleton width={POSTER_WIDTH} height={Math.round(POSTER_WIDTH * POSTER_ASPECT)} />
          <Skeleton width="22%" height={12} />
          <Skeleton width="14%" height={12} />
          <Skeleton width="10%" height={12} />
        </div>
      ))}
    </div>
  )
}

export function RecordingsView({ highlight }: { readonly highlight?: number }) {
  const queryClient = useQueryClient()
  const [view, setView] = useState<ViewMode>("list")
  const [pending, setPending] = useState<Recording | null>(null)
  const highlightRef = useHighlightRef(highlight)

  const list = useEntityList<Recording>({
    queryKey: queryKeys.recordings(),
    fetchPage: (cursor) => fetchRecordingPage(cursor),
  })
  const { hasMore, isFetching, loadingAll, loadAll } = list

  const remove = useMutation({
    mutationFn: (id: number) => deleteRecording(id),
    onSuccess: (_data, id) => {
      removeFromInfiniteLists(queryClient, queryRoots.recordings, id)
      void queryClient.invalidateQueries({ queryKey: queryRoots.recordings })
      toast.success("Recording deleted", `#${id}`)
    },
    onError: (error) => toast.error("Could not delete the recording", getErrorMessage(error, "Request failed")),
  })

  const rows = list.items

  return (
    <Page
      title="Recordings"
      description="Every finished capture that wrote a file. Open one to watch or download it — delete removes the file from disk."
      actions={
        <Button variant="ghost" size="sm" icon={<IconRefresh size={15} />} loading={isFetching} onClick={list.refetch}>
          Refresh
        </Button>
      }
    >
      <div className="toolbar">
        <span className="text-dim" style={{ fontSize: "var(--fs-sm)" }}>
          {showingLabel(rows.length)}
        </span>
        <div className="toolbar-spacer" />
        <Segmented ariaLabel="Recording layout" items={VIEW_ITEMS} active={view} onChange={setView} />
      </div>

      {list.isLoading ? (
        <Panel>
          <PanelBody>
            <RecordingsSkeleton />
          </PanelBody>
        </Panel>
      ) : list.isError ? (
        <ErrorPanel message={getErrorMessage(list.error, "Could not load recordings")} onRetry={list.refetch} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<IconRecordings size={22} />}
          title="No recordings yet."
          text="Recordings appear when a session finishes with recording enabled."
          action={
            <Link className="btn btn-secondary" to="/sessions">
              Open sessions
            </Link>
          }
        />
      ) : view === "list" ? (
        <Panel>
          <PanelBody flush>
            <Table>
              <thead>
                <tr>
                  <Th>Preview</Th>
                  <Th>Recording</Th>
                  <Th>Engine → Resolver</Th>
                  <Th>Profile</Th>
                  <Th num>Duration</Th>
                  <Th num>Size</Th>
                  <Th>Created</Th>
                  <Th>Path</Th>
                  <Th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((recording) => (
                  <RecordingRow
                    key={recording.id}
                    recording={recording}
                    onDelete={setPending}
                    highlightRef={highlightRef}
                  />
                ))}
              </tbody>
            </Table>
          </PanelBody>
        </Panel>
      ) : (
        <div className="grid-auto">
          {rows.map((recording) => (
            <RecordingTile
              key={recording.id}
              recording={recording}
              onDelete={setPending}
              highlightRef={highlightRef}
            />
          ))}
        </div>
      )}

      {!list.isLoading && !list.isError && rows.length > 0 ? (
        <LoadMore
          hasMore={hasMore}
          isFetching={isFetching}
          onLoadMore={list.loadMore}
          onLoadAll={() => void loadAll()}
          loadingAll={loadingAll}
          count={rows.length}
        />
      ) : null}

      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title="Delete this recording?"
        description="The file is removed from disk — this cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          if (pending === null) return
          try {
            await remove.mutateAsync(pending.id)
          } catch {
            // The mutation's onError surfaces the failure via toast.
          }
        }}
      />
    </Page>
  )
}
