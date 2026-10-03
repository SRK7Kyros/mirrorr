import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/Button"
import { Chip } from "@/components/ui/Chip"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { Drawer } from "@/components/ui/Drawer"
import { EmptyState } from "@/components/ui/EmptyState"
import { ErrorPanel } from "@/components/ui/ErrorPanel"
import { OverflowMenu } from "@/components/ui/OverflowMenu"
import { Skeleton } from "@/components/ui/Skeleton"
import { Table, TableBody, TableCell, TableHead, TableRow } from "@/components/ui/Table"
import { useToast } from "@/components/ui/Toast"
import { isAdmin } from "@/lib/auth"
import { queryKeys, queryRoots } from "@/lib/query-keys"
import type { Recording } from "@/lib/schemas"
import { formatBytes, formatDateTime, formatDuration, formatRelativeTime } from "@/lib/time"
import { deleteRecording, fetchRecordingPage } from "@/views/shared/api"
import { removeFromInfiniteLists, useEntityList, useHighlightRef } from "@/views/shared/hooks"
import { CopyButton, RouteLink } from "@/views/shared/parts"
import "@/styles/views-entities.css"

function highlightParam(): number | null {
  if (typeof window === "undefined") return null
  const raw = new URLSearchParams(window.location.search).get("highlight")
  if (raw === null) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function mediaServed(recording: Recording): boolean {
  return recording.content_url !== "" && recording.media_served !== false
}

/** §5.7 — Recordings archive. Link-only media (§11.18); no primary action (§11.7). */
export function RecordingsGrid() {
  const client = useQueryClient()
  const { toast } = useToast()
  const admin = isAdmin()
  const list = useEntityList<Recording>({
    queryKey: queryKeys.recordings({}),
    fetchPage: (cursor) => fetchRecordingPage(cursor),
  })
  const highlight = useHighlightRef(highlightParam())
  const [layout, setLayout] = useState<"list" | "grid">("list")
  const [openRecording, setOpenRecording] = useState<Recording | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Recording | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const removeRecording = async (recording: Recording) => {
    setDeletingId(recording.id)
    try {
      await deleteRecording(recording.id)
      removeFromInfiniteLists(client, queryRoots.recordings, recording.id)
      void client.invalidateQueries({ queryKey: queryRoots.recordings })
      toast({ kind: "success", title: "Recording deleted" })
    } catch {
      toast({ kind: "error", title: "Delete failed" })
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="ve">
      <div className="ve-bar">
        <div className="ve-filters" role="group" aria-label="Layout">
          <Chip selected={layout === "list"} onClick={() => setLayout("list")}>
            List
          </Chip>
          <Chip selected={layout === "grid"} onClick={() => setLayout("grid")}>
            Grid
          </Chip>
        </div>
        <div className="ve-bar__end">
          <span className="ve-note">Most recent first.</span>
        </div>
      </div>

      {list.isLoading ? (
        layout === "grid" ? (
          <div className="opaque ve-panel">
            <div className="ve-grid" style={{ padding: 0 }}>
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} geometry="card" />
              ))}
            </div>
          </div>
        ) : (
          <div className="opaque ve-table-panel">
            <Table label="Recordings">
              <TableHead>
                <TableRow>
                  <TableCell>Recording</TableCell>
                  <TableCell>Poster</TableCell>
                  <TableCell numeric>Duration</TableCell>
                  <TableCell numeric>Size</TableCell>
                  <TableCell>Created</TableCell>
                  {admin ? <TableCell>Owner</TableCell> : null}
                </TableRow>
              </TableHead>
              <TableBody loading columns={admin ? 6 : 5} />
            </Table>
          </div>
        )
      ) : list.isError ? (
        <ErrorPanel
          title="Could not load recordings"
          body={list.error instanceof Error ? list.error.message : "Unexpected server response."}
          actions={
            <Button variant="secondary" onClick={list.refetch}>
              Retry
            </Button>
          }
        />
      ) : list.items.length === 0 ? (
        <div className="opaque ve-panel">
          <EmptyState
            eyebrow="Recordings"
            headline="No recordings yet."
            body="Recordings appear when a session finishes with recording enabled."
            action={
              <RouteLink to="/sessions">
                <span className="btn btn--secondary">
                  <span className="btn__label">Open sessions</span>
                </span>
              </RouteLink>
            }
          />
        </div>
      ) : layout === "grid" ? (
        <div className="opaque ve-panel">
          <div className="ve-grid" style={{ padding: 0 }}>
            {list.items.map((recording) => {
              const served = mediaServed(recording)
              return (
                <article key={recording.id} className="ve-media" ref={highlight} data-id={recording.id}>
                  <div className="ve-media__poster">
                    <span className="ve-media__poster-label">no preview</span>
                  </div>
                  <span className="ve-media__name" title={recording.user_friendly_name}>
                    {recording.user_friendly_name}
                  </span>
                  <span className="ve-title-cell__meta">{recording.snake_case_name}</span>
                  <p className="ve-media__metrics">
                    <span>{formatDuration(recording.duration_seconds)}</span>
                    <span>{formatBytes(recording.size_bytes)}</span>
                    <span>{formatRelativeTime(recording.created_at)}</span>
                  </p>
                  <p className="ve-note ellipsis">
                    {`${recording.profile_name || "—"} · ${recording.engine_name} → ${recording.resolver_name}`}
                  </p>
                  {served ? null : (
                    <p className="ve-media__hint">Media not served on this install — copy link instead</p>
                  )}
                  <span className="ve-inline">
                    <Button variant="secondary" onClick={() => setOpenRecording(recording)}>
                      Open
                    </Button>
                    {served ? null : (
                      <CopyButton text={recording.content_url} label={`Copy link for ${recording.user_friendly_name}`} />
                    )}
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
                  </span>
                </article>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="opaque panel ve-table-panel">
          <Table label="Recordings" className="ve-table">
            <TableHead>
              <TableRow>
                <TableCell className="ve-c-name">Recording</TableCell>
                <TableCell>Poster</TableCell>
                <TableCell numeric>Duration</TableCell>
                <TableCell numeric>Size</TableCell>
                <TableCell>Created</TableCell>
                {admin ? <TableCell className="ve-c-owner">Owner</TableCell> : null}
                <TableCell className="ve-c-actions">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody columns={admin ? 7 : 6}>
              {list.items.map((recording) => {
                const served = mediaServed(recording)
                return (
                  <TableRow
                    key={recording.id}
                    className={deletingId === recording.id ? "ta-row--pending" : undefined}
                  >
                    <TableCell className="ve-c-name">
                      <span ref={highlight} data-id={recording.id} />
                      <span className="ve-title-cell">
                        <span className="ve-title-cell__name" title={recording.user_friendly_name}>
                          {recording.user_friendly_name}
                        </span>
                        <span className="ve-title-cell__meta">
                          {recording.snake_case_name}
                          {` · ${recording.engine_name} → ${recording.resolver_name}`}
                        </span>
                      </span>
                      {served ? null : (
                        <span className="ve-media__hint">Media not served on this install — copy link instead</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="ve-media__poster-label">no preview</span>
                    </TableCell>
                    <TableCell numeric>{formatDuration(recording.duration_seconds)}</TableCell>
                    <TableCell numeric>{formatBytes(recording.size_bytes)}</TableCell>
                    <TableCell>
                      <span className="ve-note" title={formatDateTime(recording.created_at)}>
                        {formatRelativeTime(recording.created_at)}
                      </span>
                    </TableCell>
                    {admin ? (
                      <TableCell className="ve-c-owner">
                        <span className="t-mono-inline ellipsis">
                          {recording.requester_user_token == null || recording.requester_user_token === ""
                            ? "—"
                            : recording.requester_user_token.slice(0, 12)}
                        </span>
                      </TableCell>
                    ) : null}
                    <TableCell className="ve-c-actions">
                      <span className="ve-inline">
                        <Button variant="secondary" onClick={() => setOpenRecording(recording)}>
                          Open
                        </Button>
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
                      </span>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {list.items.length > 0 ? (
        <div className="ve-bar">
          <span className="ve-note">{`Showing ${list.items.length}${list.hasMore ? "+" : ""}`}</span>
          <div className="ve-bar__end">
            {list.hasMore ? (
              <Button variant="secondary" loading={list.isFetching} onClick={list.loadMore}>
                Load more
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <RecordingDrawer
        key={openRecording?.id ?? "none"}
        recording={openRecording}
        onClose={() => setOpenRecording(null)}
        onDelete={(recording) => {
          setOpenRecording(null)
          setDeleteTarget(recording)
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          const target = deleteTarget
          setDeleteTarget(null)
          if (target !== null) void removeRecording(target)
        }}
        title={`Delete recording '${deleteTarget?.user_friendly_name ?? ""}'?`}
        body={<p>The file is removed from disk — this cannot be undone.</p>}
        tone="destructive"
        confirmLabel="Delete"
      />
    </div>
  )
}

function RecordingDrawer({
  recording,
  onClose,
  onDelete,
}: {
  recording: Recording | null
  onClose: () => void
  onDelete: (recording: Recording) => void
}) {
  const served = recording !== null && mediaServed(recording)
  return (
    <Drawer
      open={recording !== null}
      onClose={onClose}
      title={recording?.user_friendly_name ?? "Recording"}
      empty={recording === null ? <span className="ve-note">Nothing here yet.</span> : undefined}
      footer={
        recording === null ? null : (
          <span className="ve-inline">
            <Button variant="danger-text" onClick={() => onDelete(recording)}>
              Delete
            </Button>
            {recording.content_url === "" ? null : (
              <CopyButton text={recording.content_url} label="Copy media link" />
            )}
          </span>
        )
      }
    >
      {recording === null ? null : (
        <div className="ve-stack">
          <dl className="ve-kv">
            <dt className="ve-kv__label">Slug</dt>
            <dd className="ve-kv__value t-mono">{recording.snake_case_name}</dd>
            <dt className="ve-kv__label">Profile</dt>
            <dd className="ve-kv__value">{recording.profile_name || "—"}</dd>
            <dt className="ve-kv__label">Engine</dt>
            <dd className="ve-kv__value">{recording.engine_name}</dd>
            <dt className="ve-kv__label">Resolver</dt>
            <dd className="ve-kv__value">{recording.resolver_name}</dd>
            <dt className="ve-kv__label">Duration</dt>
            <dd className="ve-kv__value t-mono num">{formatDuration(recording.duration_seconds)}</dd>
            <dt className="ve-kv__label">Size</dt>
            <dd className="ve-kv__value t-mono num">{formatBytes(recording.size_bytes)}</dd>
            <dt className="ve-kv__label">Started</dt>
            <dd className="ve-kv__value">{formatDateTime(recording.started_at)}</dd>
            <dt className="ve-kv__label">Ended</dt>
            <dd className="ve-kv__value">{formatDateTime(recording.ended_at)}</dd>
            <dt className="ve-kv__label">Created</dt>
            <dd className="ve-kv__value">{formatDateTime(recording.created_at)}</dd>
            <dt className="ve-kv__label">Disk path</dt>
            <dd className="ve-kv__value t-mono">{recording.disk_path}</dd>
          </dl>
          {recording.content_url === "" ? (
            <p className="ve-note">Media not served on this install — copy link instead</p>
          ) : (
            <div className="ve-stack ve-stack--tight">
              <span className="ve-panel__title">Media URL</span>
              <span className="ve-url__value">{recording.content_url}</span>
              <span className="ve-inline">
                <a className="btn btn--secondary" href={recording.content_url} target="_blank" rel="noreferrer">
                  <span className="btn__label">{served ? "Open in new tab" : "Try link anyway"}</span>
                </a>
                <CopyButton text={recording.content_url} label="Copy media link" />
              </span>
            </div>
          )}
          <p className="ve-note">
            Content is a static file path — no scrubbing guarantees. Use the link, not an embedded player.
          </p>
        </div>
      )}
    </Drawer>
  )
}
