import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  deleteSession,
  getErrorMessage,
  removeFromInfiniteLists,
  useEntityList,
  useNameMaps,
} from "@/api";
import { fetchSessionPage } from "@/api/endpoints";
import { queryKeys, queryRoots } from "@/api/query-keys";
import {
  DEFAULT_FILTER,
  FILTER_TOKENS,
  isLive,
  isSpent,
  matchesFilter,
  shouldAutoExhaust,
  type FilterToken,
} from "@/api/domain/filter-grammar";
import type { Session } from "@/api/schemas";
import {
  BulkBar,
  Button,
  buttonClass,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  ErrorPanel,
  Fab,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSessions,
  IconTrash,
  Input,
  LoadMore,
  Panel,
  PanelBody,
  PanelHead,
  Skeleton,
  Stat,
  toast,
} from "@/ui/components";
import { useSelection } from "@/ui/hooks";
import { Page } from "@/ui/views/shared/page";
import { NewSessionDialog } from "./new-session-dialog";
import { SessionCard } from "./session-card";

const FILTER_LABELS: Record<FilterToken, string> = {
  scheduled: "Scheduled",
  live: "Live",
  spent: "Spent",
  all: "All",
};

/** Card-shaped shimmer for the first paint, matching the grid it replaces. */
function SkeletonCards({ count = 6 }: { readonly count?: number }) {
  return (
    <div
      className="session-grid"
      aria-busy="true"
      aria-label="Loading sessions"
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
            <Skeleton width="40%" />
            <Skeleton width="72%" />
            <Skeleton width="58%" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SessionsListView() {
  const queryClient = useQueryClient();
  const [tokens, setTokens] = useState<readonly FilterToken[]>(() => [
    ...DEFAULT_FILTER,
  ]);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const selection = useSelection<number>();
  const names = useNameMaps();

  const list = useEntityList<Session>({
    queryKey: queryKeys.sessions({ filter: tokens.join("+") }),
    fetchPage: (cursor) => fetchSessionPage(cursor),
  });
  const { hasMore, isFetching, loadingAll, loadAll } = list;
  const autoExhaust = shouldAutoExhaust(tokens);

  // Non-`all` filters are a client-side scope over the whole (small) set.
  useEffect(() => {
    if (!autoExhaust || !hasMore || loadingAll || isFetching) return;
    void loadAll().catch(() => undefined);
  }, [autoExhaust, hasMore, loadingAll, isFetching, loadAll]);

  const cards = useMemo(() => {
    const term = search.trim().toLowerCase();
    return list.items.filter((session) => {
      if (!matchesFilter(session.status, tokens)) return false;
      if (term === "") return true;
      return [
        String(session.id),
        session.profile_name ?? "",
        session.engine_name ?? "",
        session.resolver_name ?? "",
        session.status,
      ]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [list.items, tokens, search]);

  const cardIds = useMemo(() => cards.map((session) => session.id), [cards]);

  const bulkRemove = useMutation({
    mutationFn: async (ids: readonly number[]) => {
      for (const id of ids) await deleteSession(id);
    },
    onSuccess: (_data, ids) => {
      for (const id of ids) {
        removeFromInfiniteLists(queryClient, queryRoots.sessions, id);
        queryClient.removeQueries({ queryKey: queryKeys.session(id) });
      }
      void queryClient.invalidateQueries({ queryKey: queryRoots.sessions });
      toast.success("Sessions deleted", `${ids.length} removed`);
      selection.clear();
    },
    onError: (error) =>
      toast.error(
        "Could not delete the sessions",
        getErrorMessage(error, "Request failed"),
      ),
  });

  const tally = useMemo(() => {
    let live = 0;
    let recording = 0;
    let scheduled = 0;
    let spent = 0;
    for (const session of list.items) {
      if (isLive(session.status)) live += 1;
      if (session.status === "recording") recording += 1;
      if (session.status === "scheduled") scheduled += 1;
      if (isSpent(session.status)) spent += 1;
    }
    return { live, recording, scheduled, spent };
  }, [list.items]);

  const toggleToken = (token: FilterToken) => {
    selection.clear();
    if (token === "all") {
      setTokens(["all"]);
      return;
    }
    const without = tokens.filter(
      (value) => value !== "all" && value !== token,
    );
    const next = tokens.includes(token) ? without : [...without, token];
    setTokens(next.length === 0 ? ["all"] : next);
  };

  return (
    <Page
      title="Sessions"
      description="Live and recent capture runs. Hover a card to preview its stream; status filtering and search apply to the cards loaded so far."
      actions={
        <Button
          variant="primary"
          className="btn-create"
          icon={<IconPlus size={16} />}
          onClick={() => setCreateOpen(true)}
        >
          New session
        </Button>
      }
    >
      <Fab
        label="New session"
        icon={<IconPlus size={22} />}
        onClick={() => setCreateOpen(true)}
      />

      <Panel>
        <PanelHead
          title="Tally"
          actions={
            <span className="text-dim" style={{ fontSize: "var(--fs-sm)" }}>
              over {list.items.length} loaded
            </span>
          }
        />
        <PanelBody>
          <div className="stat-grid">
            <Stat
              label="Live"
              value={
                <>
                  {tally.live}
                  {tally.recording > 0 ? (
                    <span className="text-dim">
                      {" "}
                      · {tally.recording} recording
                    </span>
                  ) : null}
                </>
              }
            />
            <Stat label="Scheduled" value={tally.scheduled} />
            <Stat label="Spent" value={tally.spent} />
          </div>
        </PanelBody>
      </Panel>

      <div className="toolbar">
        <div className="row">
          {FILTER_TOKENS.map((token) => (
            <Button
              key={token}
              size="sm"
              variant={tokens.includes(token) ? "primary" : "outline"}
              aria-pressed={tokens.includes(token)}
              onClick={() => toggleToken(token)}
            >
              {FILTER_LABELS[token]}
            </Button>
          ))}
        </div>
        <div className="toolbar-spacer" />
        <div className="toolbar-search">
          <span className="toolbar-search-icon" aria-hidden="true">
            <IconSearch size={15} />
          </span>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter by id, profile, engine, status…"
            aria-label="Filter sessions"
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={<IconRefresh size={15} />}
          loading={isFetching}
          onClick={list.refetch}
        >
          Refresh
        </Button>
      </div>

      {list.isLoading ? (
        <SkeletonCards />
      ) : list.isError ? (
        <ErrorPanel
          message={getErrorMessage(list.error, "Could not load sessions")}
          onRetry={list.refetch}
        />
      ) : cards.length === 0 ? (
        <EmptyState
          icon={<IconSessions size={22} />}
          title={
            list.items.length === 0
              ? "No sessions yet."
              : "Nothing matches this filter"
          }
          text={
            list.items.length === 0
              ? "A session is one capture run. Start one from a profile, or build the config by hand."
              : "Widen the status filter or clear the search box."
          }
          action={
            list.items.length === 0 ? (
              <div className="row">
                <Button
                  variant="primary"
                  icon={<IconPlus size={16} />}
                  onClick={() => setCreateOpen(true)}
                >
                  New session
                </Button>
                <Link className={buttonClass({ variant: "secondary" })} to="/profiles">
                  Open profiles
                </Link>
              </div>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="session-grid-head">
            <Checkbox
              aria-label="Select all sessions"
              checked={selection.allSelected(cardIds)}
              onChange={(event) =>
                selection.setMany(event.target.checked ? cardIds : [])
              }
            />
            <span className="text-dim" style={{ fontSize: "var(--fs-sm)" }}>
              {cards.length} session{cards.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="session-grid">
            {cards.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                names={names}
                selected={selection.has(session.id)}
                onToggle={selection.toggle}
              />
            ))}
          </div>

          {selection.count > 0 ? (
            <BulkBar count={selection.count} onClear={selection.clear}>
              <Button
                size="sm"
                variant="danger-ghost"
                icon={<IconTrash size={15} />}
                loading={bulkRemove.isPending}
                onClick={() => setBulkDeleteOpen(true)}
              >
                Delete selected
              </Button>
            </BulkBar>
          ) : null}
          <LoadMore
            hasMore={hasMore}
            isFetching={isFetching}
            onLoadMore={list.loadMore}
            onLoadAll={() => void loadAll()}
            loadingAll={loadingAll}
            count={cards.length}
          />
        </>
      )}

      <ConfirmDialog
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        title={`Delete ${selection.count} selected session${selection.count === 1 ? "" : "s"}?`}
        description="A running session stops being tracked; recordings already on disk are not removed."
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          try {
            await bulkRemove.mutateAsync([...selection.selected]);
          } catch {
            // The mutation's onError surfaces the failure via toast.
          }
        }}
      />

      <NewSessionDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </Page>
  );
}
