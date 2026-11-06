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
  CardGrid,
  CardGridSkeleton,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  IconRecordings,
  IconRefresh,
  IconSearch,
  IconTrash,
  Input,
  LoadMore,
  PageToolbar,
  QueryState,
  Select,
  TimeZoneNote,
  toast,
} from "@/ui/components";
import { useDebouncedValue, useHighlightRef, useScopedSelection } from "@/ui/hooks";
import { Page } from "@/ui/views/shared/page";
import { StorageStrip } from "@/ui/views/shared/ops-strip";
import { useBulkAccessAction } from "@/ui/views/shared/resource-access-slot";
import { RecordingCard } from "./recording-card";

/**
 * Recordings — read + delete only (spec §5.7). Every finished capture is one
 * card of the shared skeleton: the file's own first frame (or a plate when the
 * install does not serve it), the duration as the headline, and a real
 * download in the footer. One toolbar owns search, sort, count and the
 * `Select` toggle; the grid is `CardGrid`, never a local copy of it.
 */

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
  const [selectMode, setSelectMode] = useState(false);
  const term = useDebouncedValue(search, 250);
  const highlightRef = useHighlightRef(highlight);

  const list = useEntityList<Recording>({
    queryKey: queryKeys.recordings({ q: term }),
    fetchPage: (cursor) => fetchRecordingPage(cursor, undefined, term),
  });
  const { hasMore, isFetching, loadingAll, loadAll } = list;

  const rows = useMemo(
    () => [...rankBySearch(list.items, term, recordingSearchFields)].sort(byOrder(order)),
    [list.items, term, order],
  );
  const rowIds = useMemo(() => rows.map((recording) => recording.id), [rows]);
  // Selection is scoped to the cards actually on screen: a search or a sort
  // drops every id it hides, so a bulk delete never touches an unseen card.
  const selection = useScopedSelection(rowIds);
  const allSelected = selection.allSelected(rowIds);
  const someSelected = selection.someSelected(rowIds);

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

  const selectedRecordings = rows.filter((recording) => selection.has(recording.id));
  const access = useBulkAccessAction(
    "recording",
    selectedRecordings.map((recording) => ({
      id: recording.id,
      label: recording.user_friendly_name,
    })),
  );

  function leaveSelectMode(): void {
    setSelectMode(false);
    selection.clear();
  }

  return (
    <Page
      title="Recordings"
      description="Every finished capture that wrote a file. Open one to watch it, or download the file."
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

      <PageToolbar
        search={
          <div className="relative [&_input]:pl-8">
            <span
              className="absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint pointer-events-none"
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
        }
        sort={
          <Select
            aria-label="Sort recordings"
            className="max-w-[180px]"
            value={order}
            onChange={(event) => setOrder(event.target.value as RecordingOrder)}
          >
            {ORDERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        }
        count={
          <span>
            {showingLabel(rows.length)}
            {order === "newest" || !hasMore ? null : (
              <span className="text-dim"> · of {list.items.length} loaded</span>
            )}
          </span>
        }
        select={
          <div className="flex items-center gap-2">
            {selectMode ? (
              <>
                <Checkbox
                  aria-label="Select all recordings"
                  checked={allSelected}
                  indeterminate={someSelected && !allSelected}
                  onChange={(event) =>
                    selection.setMany(event.target.checked ? rowIds : [])
                  }
                />
                <Button size="sm" variant="ghost" onClick={leaveSelectMode}>
                  Done
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                aria-pressed={false}
                onClick={() => setSelectMode(true)}
              >
                Select
              </Button>
            )}
          </div>
        }
        note={<TimeZoneNote />}
      />

      <QueryState
        query={list}
        loading={<CardGridSkeleton count={6} label="Loading recordings" />}
        isEmpty={rows.length === 0}
        errorMessage="Could not load recordings"
        empty={
          <EmptyState
            icon={<IconRecordings size={22} />}
            title={
              term.trim() === ""
                ? "No recordings yet."
                : `No recording matches “${term.trim()}”.`
            }
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
        }
      >
        <CardGrid rowHeight={330} label="Recordings">
          {rows.map((recording) => (
            <RecordingCard
              key={recording.id}
              recording={recording}
              onDelete={setPending}
              highlightRef={highlightRef}
              selectMode={selectMode}
              selected={selection.has(recording.id)}
              onToggle={selection.toggle}
            />
          ))}
        </CardGrid>

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
      </QueryState>

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
