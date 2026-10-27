import { useMemo, useState } from "react";
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
import { rankBySearch } from "@/api/domain/search";
import type { Recording } from "@/api/schemas";
import { showingLabel } from "@/ui/lib/format";
import {
  BulkBar,
  Button,
  buttonClass,
  ConfirmDialog,
  EmptyState,
  ErrorPanel,
  IconRecordings,
  IconRefresh,
  IconSearch,
  IconTrash,
  Input,
  LoadMore,
  Select,
  SelectionHead,
  Skeleton,
  toast,
} from "@/ui/components";
import { useDebouncedValue, useHighlightRef, useSelection } from "@/ui/hooks";
import { Page } from "@/ui/views/shared/page";
import { StorageStrip } from "@/ui/views/shared/ops-strip";
import { useBulkAccessAction } from "@/ui/views/shared/resource-access-slot";
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
      className="session-grid grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4 items-start"
      aria-busy="true"
      aria-label="Loading recordings"
    >
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="session-card flex flex-col border border-line rounded-lg bg-surface-2 overflow-hidden">
          <div className="relative aspect-video bg-sunken overflow-hidden">
            <Skeleton
              width="100%"
              height="100%"
              className="block"
            />
          </div>
          <div className="flex flex-col gap-3 px-4 pt-3 pb-4">
            <Skeleton width="48%" />
            <Skeleton width="70%" />
            <Skeleton width="56%" />
          </div>
        </div>
      ))}
    </div>
  );
}

type RecordingOrder = "newest" | "largest" | "longest";

const ORDERS: readonly { readonly value: RecordingOrder; readonly label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "largest", label: "Largest first" },
  { value: "longest", label: "Longest first" },
];

const recordingSearchFields = (recording: Recording): readonly string[] => [
  recording.user_friendly_name,
  recording.snake_case_name,
  recording.profile_name ?? "",
  recording.engine_name ?? "",
  recording.resolver_name ?? "",
  String(recording.id),
];

const byOrder = (order: RecordingOrder) => (a: Recording, b: Recording): number => {
  if (order === "largest") return b.size_bytes - a.size_bytes || b.id - a.id;
  if (order === "longest") return b.duration_seconds - a.duration_seconds || b.id - a.id;
  return b.id - a.id;
};

export function RecordingsView({ highlight }: { readonly highlight?: number }) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<Recording | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [order, setOrder] = useState<RecordingOrder>("newest");
  const term = useDebouncedValue(search, 250);
  const selection = useSelection<number>();
  const highlightRef = useHighlightRef(highlight);

  const list = useEntityList<Recording>({
    queryKey: queryKeys.recordings({ q: term }),
    fetchPage: (cursor) => fetchRecordingPage(cursor, undefined, term),
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

  const bulkRemove = useMutation({
    mutationFn: async (ids: readonly number[]) => {
      for (const id of ids) await deleteRecording(id);
    },
    onSuccess: (_data, ids) => {
      for (const id of ids) removeFromInfiniteLists(queryClient, queryRoots.recordings, id);
      void queryClient.invalidateQueries({ queryKey: queryRoots.recordings });
      toast.success("Recordings deleted", `${ids.length} removed`);
      selection.clear();
    },
    onError: (error) =>
      toast.error(
        "Could not delete the recordings",
        getErrorMessage(error, "Request failed"),
      ),
  });

  const rows = useMemo(
    () => [...rankBySearch(list.items, term, recordingSearchFields)].sort(byOrder(order)),
    [list.items, term, order],
  );
  const selectedRecordings = rows.filter((recording) => selection.has(recording.id));
  const access = useBulkAccessAction(
    "recording",
    selectedRecordings.map((recording) => ({
      id: recording.id,
      label: recording.user_friendly_name,
    })),
  );

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
      <StorageStrip />

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-dim" style={{ fontSize: "var(--fs-sm)" }}>
          {showingLabel(rows.length)}
          {order === "newest" || !hasMore ? null : (
            <span className="text-dim"> · of {list.items.length} loaded</span>
          )}
        </span>
        <div className="flex-1" />
        <Select
          aria-label="Sort recordings"
          className="max-w-[180px] max-sm:max-w-none"
          value={order}
          onChange={(event) => setOrder(event.target.value as RecordingOrder)}
        >
          {ORDERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <div className="relative flex-1 min-w-[200px] max-w-[340px] [&_input]:pl-8">
          <span
            className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none"
            aria-hidden="true"
          >
            <IconSearch size={15} />
          </span>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name, profile, source…"
            aria-label="Search recordings"
          />
        </div>
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
          title={term.trim() === "" ? "No recordings yet." : `No recording matches “${term.trim()}”.`}
          text={
            term.trim() === ""
              ? "Recordings appear when a session finishes with recording enabled."
              : "The search reaches the whole library, not just the cards loaded so far."
          }
          action={
            term.trim() === "" ? (
              <Link className={buttonClass({ variant: "secondary" })} to="/sessions">
                Open sessions
              </Link>
            ) : (
              <Button variant="secondary" onClick={() => setSearch("")}>
                Clear search
              </Button>
            )
          }
        />
      ) : (
        <>
          <SelectionHead
            label="Select all recordings"
            checked={selection.allSelected(rows.map((recording) => recording.id))}
            onChange={(checked) =>
              selection.setMany(checked ? rows.map((recording) => recording.id) : [])
            }
            count={rows.length}
            noun="recording"
          />
          <div className="session-grid grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4 items-start">
            {rows.map((recording) => (
              <RecordingCard
                key={recording.id}
                recording={recording}
                onDelete={setPending}
                highlightRef={highlightRef}
                selected={selection.has(recording.id)}
                onToggle={selection.toggle}
              />
            ))}
          </div>

          {selection.count > 0 ? (
            <BulkBar
              count={selection.count}
              onClear={selection.clear}
              actions={[
                ...(access.action === null ? [] : [access.action]),
                {
                  key: "delete",
                  label: "Delete selected",
                  icon: <IconTrash size={15} />,
                  danger: true,
                  loading: bulkRemove.isPending,
                  onClick: () => setBulkDeleteOpen(true),
                },
              ]}
            />
          ) : null}
          {access.dialog}

          <LoadMore
            hasMore={hasMore}
            isFetching={isFetching}
            onLoadMore={list.loadMore}
            onLoadAll={() => void loadAll().catch(() => undefined)}
            loadingAll={loadingAll}
            count={rows.length}
          />
        </>
      )}

      <ConfirmDialog
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        title={`Delete ${selection.count} recording${selection.count === 1 ? "" : "s"}?`}
        description="The files are removed from disk — this cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          try {
            await bulkRemove.mutateAsync([...selection.selected]);
          } catch {
            // The mutation's onError surfaces the failure via toast.
          }
          setBulkDeleteOpen(false);
        }}
      />

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
