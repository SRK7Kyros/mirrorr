import { useEffect, useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  deleteAutorun,
  downloadJson,
  fetchAutorunExport,
  getErrorMessage,
  mergeBundles,
  removeFromInfiniteLists,
  updateAutorun,
  useEntityList,
  useNameMaps,
} from "@/api"
import { fetchAutorunPage } from "@/api/endpoints"
import { queryKeys, queryRoots } from "@/api/query-keys"
import type { FallbackRung } from "@/api/domain/fallback-chain"
import {
  FILTER_TOKENS,
  matchesFilter,
  shouldAutoExhaust,
  type FilterToken,
} from "@/api/domain/filter-grammar"
import { rankBySearch } from "@/api/domain/search"
import type { Autorun } from "@/api/schemas"
import {
  BulkBar,
  Button,
  CardGrid,
  CardGridSkeleton,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Fab,
  FilterSegmented,
  IconAutoruns,
  IconDownload,
  IconPlus,
  IconProfiles,
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
} from "@/ui/components"
import { useScopedSelection } from "@/ui/hooks"
import { Page } from "@/ui/views/shared/page"
import { useBulkAccessAction } from "@/ui/views/shared/resource-access-slot"
import { AutorunCard, runTarget } from "./autorun-card"
import { AutorunBulkProfileDialog } from "./autorun-bulk-profile-dialog"
import { AutorunFormDialog } from "./autorun-form-dialog"

/** `scheduled` renders as the spec's "Upcoming" filter (spec §5.5). */
const FILTER_LABELS: Record<FilterToken, string> = {
  scheduled: "Upcoming",
  live: "Live",
  spent: "Finished",
  all: "All",
}

const FILTER_ITEMS = FILTER_TOKENS.map((token) => ({ id: token, label: FILTER_LABELS[token] }))

type SortKey = "soonest" | "name"

const SORT_LABELS: Record<SortKey, string> = {
  soonest: "Soonest first",
  name: "Name (A–Z)",
}

/** Epoch ms, or `null` for an unusable timestamp (which sorts last). */
function runTargetMs(autorun: Autorun): number | null {
  const parsed = Date.parse(runTarget(autorun))
  return Number.isNaN(parsed) ? null : parsed
}

/** Soonest first, so the next recording to run leads the list; id breaks ties. */
function bySoonest(a: Autorun, b: Autorun): number {
  const left = runTargetMs(a)
  const right = runTargetMs(b)
  if (left === null || right === null) {
    if (left === right) return a.id - b.id
    return left === null ? 1 : -1
  }
  return left !== right ? left - right : a.id - b.id
}

/** Alphabetical, for the one list where "next up" is not what you are looking for. */
function byName(a: Autorun, b: Autorun): number {
  return a.user_friendly_name.localeCompare(b.user_friendly_name) || a.id - b.id
}

const autorunSearchFields = (autorun: Autorun): readonly string[] => [
  String(autorun.id),
  autorun.user_friendly_name,
  autorun.snake_case_name,
  autorun.status,
  autorun.profile_name ?? "",
  autorun.engine_name ?? "",
  autorun.resolver_name ?? "",
]

/**
 * Autoruns — one row per one-shot schedule, as cards (decision §0: the grid is
 * the product, the card is what changed).
 *
 * The page owns one toolbar, one query gate and the selection; the card owns
 * its four slots (`autorun-card.tsx`). Nothing here re-derives state — the
 * chip, the hero and the flag all come from the record.
 */
export function AutorunsListView() {
  const queryClient = useQueryClient()
  const [token, setToken] = useState<FilterToken>("all")
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<SortKey>("soonest")
  const [selectMode, setSelectMode] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkProfileOpen, setBulkProfileOpen] = useState(false)
  const names = useNameMaps()

  const list = useEntityList<Autorun>({
    queryKey: queryKeys.autoruns({ filter: token }),
    fetchPage: (cursor) => fetchAutorunPage(cursor),
  })
  const { hasMore, isFetching, loadingAll, loadAll } = list
  const autoExhaust = shouldAutoExhaust([token])

  // Non-`all` filters are a client-side scope over the whole (small) set.
  useEffect(() => {
    if (!autoExhaust || !hasMore || loadingAll || isFetching) return
    void loadAll().catch(() => undefined)
  }, [autoExhaust, hasMore, loadingAll, isFetching, loadAll])

  // The filter is a hard scope; the search term only ranks what is left, so the
  // chosen sort stays the tie-break.
  const rows = useMemo(
    () =>
      rankBySearch(
        [...list.items.filter((autorun) => matchesFilter(autorun.status, [token]))].sort(
          sort === "name" ? byName : bySoonest,
        ),
        search,
        autorunSearchFields,
      ),
    [list.items, token, sort, search],
  )

  const rowIds = useMemo(() => rows.map((autorun) => autorun.id), [rows])
  // Selection is scoped to the cards on screen: a filter or a narrower search
  // drops the ids it hides, so "Delete 4 selected" can never mean two you
  // cannot see.
  const selection = useScopedSelection(rowIds)

  const selectedAutoruns = rows.filter((autorun) => selection.has(autorun.id))
  const selectedIds = selectedAutoruns.map((autorun) => autorun.id)
  const access = useBulkAccessAction(
    "autorun",
    selectedAutoruns.map((autorun) => ({
      id: autorun.id,
      label: autorun.user_friendly_name,
    })),
  )

  const bulkRemove = useMutation({
    mutationFn: async (ids: readonly number[]) => {
      const deleted: number[] = []
      const failed: number[] = []
      for (const id of ids) {
        try {
          await deleteAutorun(id)
          deleted.push(id)
        } catch {
          failed.push(id)
        }
      }
      return { deleted, failed }
    },
    onSuccess: ({ deleted, failed }) => {
      for (const id of deleted) {
        removeFromInfiniteLists(queryClient, queryRoots.autoruns, id)
        queryClient.removeQueries({ queryKey: queryKeys.autorun(id) })
      }
      void queryClient.invalidateQueries({ queryKey: queryRoots.autoruns })
      if (failed.length === 0) {
        toast.success("Autoruns deleted", `${deleted.length} removed`)
      } else if (deleted.length === 0) {
        toast.error("Nothing was deleted", `${failed.length} could not be removed`)
      } else {
        toast.success(
          "Autoruns partly deleted",
          `${deleted.length} removed, ${failed.length} skipped`,
        )
      }
      selection.setMany(failed)
    },
    onError: (error) => toast.error("Could not delete the autoruns", getErrorMessage(error, "Request failed")),
  })

  const bulkExport = useMutation({
    mutationFn: async (targets: readonly Autorun[]) => {
      const bundles = await Promise.all(targets.map((target) => fetchAutorunExport(target.id)))
      return mergeBundles(bundles)
    },
    onSuccess: (bundle, targets) => {
      if (downloadJson(`autoruns-${targets.length}.json`, bundle)) {
        toast.success("Autoruns exported", `${targets.length} bundled`)
        selection.clear()
      } else {
        toast.error("Export failed", "The download could not be started.")
      }
    },
    onError: (error) => toast.error("Could not export the autoruns", getErrorMessage(error, "Request failed")),
  })

  const bulkSetProfile = useMutation({
    mutationFn: async ({
      rows,
      profileId,
      chain,
    }: {
      rows: readonly Autorun[]
      profileId: number
      chain: readonly FallbackRung[]
    }) => {
      const failed: { id: number; reason: string }[] = []
      for (const row of rows) {
        try {
          await updateAutorun(row.id, {
            profile_id: profileId,
            fallback_chain: chain,
          })
        } catch (error) {
          failed.push({ id: row.id, reason: getErrorMessage(error, "Request failed") })
        }
      }
      return { updated: rows.length - failed.length, failed }
    },
    onSuccess: ({ updated, failed }) => {
      void queryClient.invalidateQueries({ queryKey: queryRoots.autoruns })
      if (failed.length === 0) {
        toast.success("Profile set", `${updated} autorun${updated === 1 ? "" : "s"} updated`)
      } else if (updated === 0) {
        toast.error("Profile not set", `${failed.length} could not be updated — ${failed[0].reason}`)
      } else {
        toast.success("Profile partly set", `${updated} updated, ${failed.length} not — ${failed[0].reason}`)
      }
      selection.clear()
      setBulkProfileOpen(false)
    },
    onError: (error) => toast.error("Could not set the profile", getErrorMessage(error, "Request failed")),
  })

  const changeFilter = (next: FilterToken) => {
    setToken(next)
    selection.clear()
  }

  const toggleSelectMode = () => {
    setSelectMode((current) => {
      if (current) selection.clear()
      return !current
    })
  }

  const allSelected = selection.allSelected(rowIds)
  const someSelected = selection.someSelected(rowIds)

  const toolbar = (
    <PageToolbar
      filters={
        <FilterSegmented
          items={FILTER_ITEMS}
          value={token}
          onChange={changeFilter}
          ariaLabel="Filter autoruns by status"
        />
      }
      search={
        <div className="relative [&_input]:pl-8">
          <span
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint"
            aria-hidden="true"
          >
            <IconSearch size={15} />
          </span>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter by name, slug, engine, status…"
            aria-label="Filter autoruns"
          />
        </div>
      }
      sort={
        <Select
          value={sort}
          aria-label="Sort autoruns"
          onChange={(event) => setSort(event.target.value === "name" ? "name" : "soonest")}
        >
          {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
            <option key={key} value={key}>
              {SORT_LABELS[key]}
            </option>
          ))}
        </Select>
      }
      count={`${rows.length} autorun${rows.length === 1 ? "" : "s"}`}
      select={
        <>
          {selectMode ? (
            <Checkbox
              aria-label="Select all autoruns"
              checked={allSelected}
              indeterminate={someSelected && !allSelected}
              onChange={(event) => {
                if (event.target.checked) selection.setMany(rowIds)
                else selection.clear()
              }}
            />
          ) : null}
          <Button
            size="sm"
            variant={selectMode ? "secondary" : "ghost"}
            aria-pressed={selectMode}
            onClick={toggleSelectMode}
          >
            Select
          </Button>
        </>
      }
      refresh={
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
      note={<TimeZoneNote />}
    />
  )

  return (
    <Page
      title="Autoruns"
      description="One-shot schedules, soonest first. An autorun starts at its start time, records once, then retires — the filter and the search apply to the rows loaded so far."
      actions={
        <Button
          variant="primary"
          className="max-sm:hidden"
          icon={<IconPlus size={16} />}
          onClick={() => setCreateOpen(true)}
        >
          New autorun
        </Button>
      }
    >
      <Fab label="New autorun" icon={<IconPlus size={22} />} onClick={() => setCreateOpen(true)} />

      {toolbar}

      <QueryState
        query={list}
        loading={<CardGridSkeleton media={false} label="Loading autoruns" />}
        isEmpty={rows.length === 0}
        empty={
          <EmptyState
            icon={<IconAutoruns size={22} />}
            title={list.items.length === 0 ? "No autoruns yet." : "Nothing matches this filter"}
            text={
              list.items.length === 0
                ? "An autorun records a stream at a set time, runs once, then retires."
                : "Widen the status filter or clear the search box."
            }
            action={
              list.items.length === 0 ? (
                <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => setCreateOpen(true)}>
                  New autorun
                </Button>
              ) : undefined
            }
          />
        }
        errorMessage="Could not load autoruns"
        onRetry={list.refetch}
      >
        <CardGrid rowHeight={250} label="Autoruns">
          {rows.map((autorun) => (
            <AutorunCard
              key={autorun.id}
              autorun={autorun}
              names={names}
              selected={selection.has(autorun.id)}
              selectMode={selectMode}
              onToggle={selection.toggle}
            />
          ))}
        </CardGrid>

        {selection.count > 0 ? (
          <BulkBar
            nextToFab
            count={selectedIds.length}
            onClear={selection.clear}
            actions={[
              {
                key: "profile",
                label: "Set profile",
                icon: <IconProfiles size={15} />,
                onClick: () => setBulkProfileOpen(true),
              },
              ...(access.action === null ? [] : [access.action]),
              {
                key: "export",
                label: "Export selected",
                icon: <IconDownload size={15} />,
                loading: bulkExport.isPending,
                onClick: () => bulkExport.mutate(selectedAutoruns),
              },
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
        title={`Delete ${selectedIds.length} selected autorun${selectedIds.length === 1 ? "" : "s"}?`}
        description="An autorun that has already run cannot be deleted — only upcoming ones can."
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          try {
            await bulkRemove.mutateAsync(selectedIds)
          } catch {
            // The mutation's onError surfaces the failure via toast.
          }
        }}
      />

      <AutorunBulkProfileDialog
        open={bulkProfileOpen}
        onClose={() => setBulkProfileOpen(false)}
        count={selectedIds.length}
        busy={bulkSetProfile.isPending}
        onApply={(profileId, chain) =>
          bulkSetProfile.mutate({ rows: selectedAutoruns, profileId, chain })
        }
      />

      <AutorunFormDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </Page>
  )
}
