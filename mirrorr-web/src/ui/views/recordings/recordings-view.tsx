import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  deleteRecording,
  getErrorMessage,
  removeFromInfiniteLists,
  useEntityList,
} from "@/api";
import { fetchRecordingPage } from "@/api/endpoints";
import { queryKeys, queryRoots } from "@/api/query-keys";
import type { Recording } from "@/api/schemas";
import { showingLabel } from "@/ui/lib/format";
import {
  Button,
  buttonClass,
  ConfirmDialog,
  EmptyState,
  ErrorPanel,
  IconRecordings,
  IconRefresh,
  LoadMore,
  Skeleton,
  toast,
} from "@/ui/components";
import { useHighlightRef } from "@/ui/hooks";
import { Page } from "@/ui/views/shared/page";
import { RecordingCard } from "./recording-card";

/**
 * Recordings — read + delete only (spec §5.7). Each finished capture is a card
 * that previews the file on hover (or via the play button on touch) and offers
 * its served URL plus where it lives on disk, mirroring the sessions grid.
 */

/** Card-shaped shimmer for the first paint, matching the grid it replaces. */
function RecordingsSkeleton({ count = 6 }: { readonly count?: number }) {
  return (
    <div
      className="session-grid"
      aria-busy="true"
      aria-label="Loading recordings"
    >
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="session-card">
          <div className="session-preview-box">
            <Skeleton
              width="100%"
              height="100%"
              className="session-preview-box-fill"
            />
          </div>
          <div className="session-card-body">
            <Skeleton width="48%" />
            <Skeleton width="70%" />
            <Skeleton width="56%" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function RecordingsView({ highlight }: { readonly highlight?: number }) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<Recording | null>(null);
  const highlightRef = useHighlightRef(highlight);

  const list = useEntityList<Recording>({
    queryKey: queryKeys.recordings(),
    fetchPage: (cursor) => fetchRecordingPage(cursor),
  });
  const { hasMore, isFetching, loadingAll, loadAll } = list;

  const remove = useMutation({
    mutationFn: (id: number) => deleteRecording(id),
    onSuccess: (_data, id) => {
      removeFromInfiniteLists(queryClient, queryRoots.recordings, id);
      void queryClient.invalidateQueries({ queryKey: queryRoots.recordings });
      toast.success("Recording deleted", `#${id}`);
    },
    onError: (error) =>
      toast.error(
        "Could not delete the recording",
        getErrorMessage(error, "Request failed"),
      ),
  });

  const rows = list.items;

  return (
    <Page
      title="Recordings"
      description="Every finished capture that wrote a file. Hover a card to preview it, open to watch or download — delete removes the file from disk."
      actions={
        <Button
          variant="ghost"
          size="sm"
          icon={<IconRefresh size={15} />}
          loading={isFetching}
          onClick={list.refetch}
        >
          Refresh
        </Button>
      }
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-dim" style={{ fontSize: "var(--fs-sm)" }}>
          {showingLabel(rows.length)}
        </span>
      </div>

      {list.isLoading ? (
        <RecordingsSkeleton />
      ) : list.isError ? (
        <ErrorPanel
          message={getErrorMessage(list.error, "Could not load recordings")}
          onRetry={list.refetch}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<IconRecordings size={22} />}
          title="No recordings yet."
          text="Recordings appear when a session finishes with recording enabled."
          action={
            <Link className={buttonClass({ variant: "secondary" })} to="/sessions">
              Open sessions
            </Link>
          }
        />
      ) : (
        <>
          <div className="session-grid">
            {rows.map((recording) => (
              <RecordingCard
                key={recording.id}
                recording={recording}
                onDelete={setPending}
                highlightRef={highlightRef}
              />
            ))}
          </div>

          <LoadMore
            hasMore={hasMore}
            isFetching={isFetching}
            onLoadMore={list.loadMore}
            onLoadAll={() => void loadAll()}
            loadingAll={loadingAll}
            count={rows.length}
          />
        </>
      )}

      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title="Delete this recording?"
        description="The file is removed from disk — this cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          if (pending === null) return;
          try {
            await remove.mutateAsync(pending.id);
          } catch {
            // The mutation's onError surfaces the failure via toast.
          }
        }}
      />
    </Page>
  );
}
