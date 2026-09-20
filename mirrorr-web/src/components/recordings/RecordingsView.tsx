/**
 * V7 — recordings (spec L303-L322, contract §6/§13.11.3/§13.11.5/§13.12.2).
 *
 * Link-out-only: no `<video>` embed ever; the one HEAD reachability probe per
 * session runs on the first Open click (never per row) and the empty
 * `content_url` case renders the muted hint instead of an Open action.
 */
import { useEffect, useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Film } from "lucide-react"
import { RecordingCard } from "@/components/recordings/RecordingCard"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { EMPTY_STATES, EmptyState } from "@/components/ui/EmptyState"
import { ErrorPanel } from "@/components/ui/ErrorPanel"
import { SKELETON_PRESETS, SkeletonRows } from "@/components/ui/SkeletonRows"
import { Button } from "@/components/ui/Button"
import { useHighlight } from "@/hooks/use-highlight"
import { useInfiniteList } from "@/hooks/use-infinite-list"
import { useStorePendingVersion } from "@/hooks/use-store-pending"
import { copyText } from "@/lib/clipboard"
import type { EntityStore } from "@/lib/entity-store"
import { entityStore } from "@/lib/entity-store-client"
import { userMessageForError } from "@/lib/errors"
import { probeMediaOnce } from "@/lib/media-probe"
import { deleteEntity } from "@/lib/optimistic-policy"
import { queryKeys } from "@/lib/query-keys"
import { deleteRecording, fetchRecordingsPage } from "@/lib/recordings-api"
import { recordingHasMedia, type Recording } from "@/lib/schemas/recordings"
import { showToast } from "@/lib/toast"

export const MEDIA_NOT_REACHABLE_MESSAGE = "Media not reachable — file may not be served"
export const RECORDING_SAVED_MESSAGE = "Recording saved"
export const LINK_COPIED_MESSAGE = "Link copied"
export const COPY_FAILED_MESSAGE = "Could not copy the link"
export const DELETE_RECORDING_CONFIRM_BODY = "Permanently deletes the file"

export interface RecordingsViewProps {
  readonly highlight?: number | null
  readonly store?: EntityStore
}

export function RecordingsView({ highlight = null, store = entityStore }: RecordingsViewProps) {
  const queryClient = useQueryClient()
  useStorePendingVersion(store)

  const list = useInfiniteList<Recording>({
    queryKey: queryKeys.recordings(),
    fetchPage: fetchRecordingsPage,
    refetchOnWindowFocus: true,
  })

  const [deleteTarget, setDeleteTarget] = useState<Recording | null>(null)
  const [deletePending, setDeletePending] = useState(false)

  const ids = useMemo(() => list.rows.map((row) => row.id), [list.rows])
  const { containerRef, highlightedId } = useHighlight<HTMLDivElement>(highlight, ids)

  // L317: `recording.created` refetches and raises the "Recording saved" toast
  // with its Open action; `recording.deleted` removes the card.
  useEffect(
    () =>
      store.subscribeFrames((frame) => {
        if (frame.event === "recording.created") {
          void queryClient.invalidateQueries({ queryKey: queryKeys.recordings() })
          const url = frame.data?.content_url
          const href = typeof url === "string" && url.trim().length > 0 ? url : null
          showToast(RECORDING_SAVED_MESSAGE, "info", href === null ? undefined : { label: "Open", href })
        }
        if (frame.event === "recording.deleted") {
          void queryClient.invalidateQueries({ queryKey: queryKeys.recordings() })
        }
      }),
    [queryClient, store],
  )

  async function openRecording(recording: Recording) {
    const url = recording.content_url
    if (!recordingHasMedia(recording) || url === null || url === undefined) return
    const outcome = await probeMediaOnce(url)
    if (outcome.kind === "unreachable") showToast(MEDIA_NOT_REACHABLE_MESSAGE)
    window.open(url, "_blank", "noopener,noreferrer")
  }

  async function copyRecording(recording: Recording) {
    const copied = await copyText(recording.content_url ?? "")
    showToast(copied ? LINK_COPIED_MESSAGE : COPY_FAILED_MESSAGE, copied ? "info" : "error")
  }

  async function confirmDelete() {
    if (deleteTarget === null) return
    setDeletePending(true)
    try {
      await deleteEntity(store, {
        resource: "recording",
        id: deleteTarget.id,
        mutate: () => deleteRecording(deleteTarget.id),
      })
      setDeleteTarget(null)
    } catch (error) {
      showToast(userMessageForError(error))
    } finally {
      setDeletePending(false)
    }
  }

  return (
    <main data-testid="recordings-view" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-title font-semibold text-text-primary">Recordings</h1>
      </div>

      {list.isInitialLoading ? (
        <SkeletonRows
          variant={SKELETON_PRESETS.recordings.variant}
          count={SKELETON_PRESETS.recordings.count}
          label="Loading recordings"
        />
      ) : null}

      {list.isError ? (
        <ErrorPanel
          message={userMessageForError(list.error)}
          onRetry={() => void queryClient.invalidateQueries({ queryKey: queryKeys.recordings(), type: "all" })}
        />
      ) : null}

      {!list.isInitialLoading && !list.isError && list.rows.length === 0 ? (
        <EmptyState title={EMPTY_STATES.recordings} icon={Film} />
      ) : null}

      <div
        ref={containerRef}
        data-testid="recordings-grid"
        className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4"
      >
        {list.rows.map((row) => (
          <RecordingCard
            key={row.id}
            recording={row}
            highlighted={highlightedId === row.id}
            pending={store.getPending("recording", row.id) !== undefined}
            onOpen={(target) => void openRecording(target)}
            onCopy={(target) => void copyRecording(target)}
            onDelete={setDeleteTarget}
          />
        ))}
      </div>

      {list.hasMore ? (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={() => void list.loadMore()} disabled={list.isLoadingMore}>
            {list.isLoadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete recording?"
        body={
          deleteTarget === null ? null : (
            <span className="flex flex-col gap-1">
              <span>{`Delete "${deleteTarget.user_friendly_name}"?`}</span>
              <span>{DELETE_RECORDING_CONFIRM_BODY}</span>
            </span>
          )
        }
        confirmLabel="Delete recording"
        pending={deletePending}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </main>
  )
}
