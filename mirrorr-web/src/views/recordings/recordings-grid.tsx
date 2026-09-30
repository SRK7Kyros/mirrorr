import { useCallback, useMemo, useState } from "react"
import { Button } from "@/components/ui/Button"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { EmptyState } from "@/components/ui/EmptyState"
import { ErrorPanel } from "@/components/ui/ErrorPanel"
import { OverflowMenu } from "@/components/ui/OverflowMenu"
import { Skeleton } from "@/components/ui/Skeleton"
import { useToast } from "@/components/ui/Toast"
import { queryKeys, queryRoots, resolveEntityName } from "@/lib/query-keys"
import type { Recording } from "@/lib/schemas"
import { formatBytes, formatDuration, formatRelativeTime } from "@/lib/time"
import { deleteRecording, fetchRecordingPage, probeMediaUrl } from "@/views/shared/api"
import { removeFromInfiniteLists, useEntityList, useHighlightRef, useNameMaps } from "@/views/shared/hooks"
import { CopyButton } from "@/views/shared/parts"
import { useQueryClient } from "@tanstack/react-query"

function highlightParam(): number | null {
  if (typeof window === "undefined") return null
  const raw = new URLSearchParams(window.location.search).get("highlight")
  if (raw === null) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

/** V7 — Recordings grid (`/recordings`, `?highlight=<id>`). */
export function RecordingsGrid() {
  const names = useNameMaps()
  const client = useQueryClient()
  const { toast } = useToast()
  const list = useEntityList<Recording>({
    queryKey: queryKeys.recordings({}),
    fetchPage: (cursor) => fetchRecordingPage(cursor),
  })
  const highlightId = highlightParam()
  const highlight = useHighlightRef(highlightId)
  const [deleteTarget, setDeleteTarget] = useState<Recording | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const openMedia = useCallback(
    (recording: Recording) => {
      const url = recording.content_url ?? ""
      if (url === "" || recording.media_served === false) {
        toast({ kind: "error", title: "Media not served on this install" })
        return
      }
      window.open(url, "_blank", "noreferrer")
      void probeMediaUrl(url).then((ok) => {
        if (!ok) toast({ kind: "error", title: "Media not reachable — file may not be served" })
      })
    },
    [toast],
  )

  const removeRecording = useCallback(
    async (recording: Recording) => {
      setDeletingId(recording.id)
      try {
        await deleteRecording(recording.id)
        removeFromInfiniteLists(client, queryRoots.recordings, recording.id)
        void client.invalidateQueries({ queryKey: queryRoots.recordings })
      } catch {
        toast({ kind: "error", title: "Delete failed" })
      } finally {
        setDeletingId(null)
      }
    },
    [client, toast],
  )

  const cards = useMemo(
    () =>
      list.items.map((recording) => {
        const mediaOff = recording.content_url === "" || recording.media_served === false
        return (
          <article
            key={recording.id}
            className="card card-stack"
            ref={highlight}
            data-deleting={deletingId === recording.id ? "true" : undefined}
          >
            <h2 className="card__title ellipsis" title={recording.user_friendly_name}>
              {recording.user_friendly_name}
            </h2>
            <span className="t-mono-inline ellipsis">{recording.snake_case_name}</span>
            <p className="card-meta">
              {resolveEntityName(recording.engine_name, names.engines, null)} ·{" "}
              {resolveEntityName(recording.resolver_name, names.resolvers, null)} ·{" "}
              {recording.profile_name}
            </p>
            <p className="card-metrics">
              <span className="num">{formatDuration(recording.duration_seconds)}</span>
              <span className="num">{formatBytes(recording.size_bytes)}</span>
              <span className="num">{formatRelativeTime(recording.created_at)}</span>
            </p>
            {mediaOff ? (
              <p className="t-meta">Media not served on this install</p>
            ) : null}
            <footer className="card-actions">
              <Button variant="ghost" onClick={() => openMedia(recording)} disabled={mediaOff}>
                Open
              </Button>
              <CopyButton
                text={recording.content_url}
                label={`Copy link for ${recording.user_friendly_name}`}
              />
              <OverflowMenu
                items={[
                  {
                    id: "delete",
                    label: "Delete",
                    destructive: true,
                    onSelect: () => setDeleteTarget(recording),
                  },
                ]}
                triggerLabel={`Actions for ${recording.user_friendly_name}`}
              />
            </footer>
          </article>
        )
      }),
    [list.items, names, highlight, openMedia, deletingId],
  )

  return (
    <div className="view">
      {list.isLoading ? (
        <div className="card-grid">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} geometry="card" />
          ))}
        </div>
      ) : list.isError ? (
        <ErrorPanel
          title="Request failed"
          body={list.error instanceof Error ? list.error.message : "Unexpected server response"}
          actions={
            <Button variant="ghost" onClick={list.refetch}>
              Retry
            </Button>
          }
        />
      ) : list.items.length === 0 ? (
        <EmptyState
          headline="No recordings"
          body="No recordings yet — enable recording on a session"
          action={
            <Button variant="ghost" onClick={() => void (window.location.href = "/sessions")}>
              Go to sessions
            </Button>
          }
        />
      ) : (
        <div className="card-grid">{cards}</div>
      )}

      {list.items.length > 0 && list.hasMore ? (
        <div className="list-footer">
          <span className="num">{`Showing ${list.items.length}`}</span>
          <Button variant="ghost" loading={list.isFetching} onClick={list.loadMore}>
            Load more
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          const target = deleteTarget
          setDeleteTarget(null)
          if (target !== null) void removeRecording(target)
        }}
        title={`Delete recording '${deleteTarget?.user_friendly_name ?? ""}'?`}
        body={<p>Permanently deletes the file.</p>}
        tone="destructive"
        confirmLabel="Delete"
      />
    </div>
  )
}
