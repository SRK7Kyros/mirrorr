import { useEffect, useId, useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { motion } from "motion/react"
import {
  deleteSource,
  getErrorMessage,
  removeFromInfiniteLists,
  useEntityList,
  useNameMaps,
  useProfiles,
  type NameMaps,
} from "@/api"
import { fetchSourcePage } from "@/api/endpoints"
import { queryKeys, queryRoots, resolveEntityName } from "@/api/query-keys"
import { rankBySearch } from "@/api/domain/search"
import type { ResolverSource } from "@/api/schemas"
import { pluralize } from "@/ui/lib/format"
import { staggerContainer, staggerItem } from "@/ui/lib/motion"
import { AccessButton, useBulkAccessAction } from "@/ui/views/shared/resource-access-slot"
import {
  BulkBar,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  IconPlus,
  IconProfiles,
  IconTrash,
  JsonView,
  LoadMore,
  Panel,
  PanelBody,
  QueryState,
  RowActions,
  Table,
  Td,
  Th,
  toast,
} from "@/ui/components"
import { useScopedSelection } from "@/ui/hooks"
import { Section } from "@/ui/views/shared/page"
import {
  ConfigRow,
  DisclosureToggle,
  ListSectionHead,
  ListSkeleton,
  SelectAllBox,
  orderRows,
  type ListOrder,
} from "@/ui/views/shared/list-rows"

/**
 * Sources — the "resolver-only profile": a saved `(resolver_id, resolver_config)`
 * pair that can be picked wherever a resolver asks for a config. Same
 * create/update/delete surface as profiles; no engine and no retry policy.
 *
 * The section reads the page's search term, sort order and select mode from
 * `ProfilesView`: one toolbar governs both halves, so this panel owns no
 * controls of its own beyond the one action that makes a source.
 */

interface SourceRowProps {
  readonly source: ResolverSource
  readonly names: NameMaps
  readonly selectMode: boolean
  readonly selected: boolean
  readonly expanded: boolean
  /** Profiles that capture through the same resolver — a source has no id references. */
  readonly usedBy: number
  readonly onToggleSelect: () => void
  readonly onToggleExpanded: () => void
  readonly onEdit: () => void
  readonly onDelete: () => void
}

const sourceSearchFields = (source: ResolverSource): readonly string[] => [
  source.name,
  source.resolver_name ?? "",
]

/** The row's overflow — edit and the destructive delete, nowhere else. */
function sourceActions(onEdit: () => void, onDelete: () => void) {
  return [
    { label: "Edit", onSelect: onEdit },
    { label: "Delete", danger: true, separatorBefore: true, onSelect: onDelete },
  ] as const
}

function SourceRow({
  source,
  names,
  selectMode,
  selected,
  expanded,
  usedBy,
  onToggleSelect,
  onToggleExpanded,
  onEdit,
  onDelete,
}: SourceRowProps) {
  const configId = useId()
  const resolver = resolveEntityName(source.resolver_name, names.resolvers, source.resolver_id)

  return (
    <>
      <tr data-id={source.id} data-selected={selected}>
        {selectMode ? (
          <Td className="cell-check">
            <Checkbox
              aria-label={`Select ${source.name}`}
              checked={selected}
              onChange={onToggleSelect}
            />
          </Td>
        ) : null}
        <Td>
          <div className="flex min-w-0 items-center gap-2">
            <DisclosureToggle
              open={expanded}
              controls={configId}
              label={`${expanded ? "Hide" : "Show"} config for ${source.name}`}
              onToggle={onToggleExpanded}
            />
            <span className="truncate" title={source.name}>
              {source.name}
            </span>
          </div>
        </Td>
        <Td className="text-ink-muted">{resolver}</Td>
        <Td num title={`${usedBy} profile${usedBy === 1 ? "" : "s"} use ${resolver}`}>
          {usedBy}
        </Td>
        <Td actions>
          <div className="flex items-center justify-end gap-1">
            <AccessButton resourceType="source" id={source.id} label={source.name} />
            <RowActions
              label={`Actions for ${source.name}`}
              actions={sourceActions(onEdit, onDelete)}
            />
          </div>
        </Td>
      </tr>
      {expanded ? (
        <ConfigRow id={configId} columns={selectMode ? 5 : 4}>
          <JsonView value={source.resolver_config ?? {}} label="Resolver config" />
        </ConfigRow>
      ) : null}
    </>
  )
}

function SourceCard({
  source,
  names,
  selectMode,
  selected,
  usedBy,
  onToggleSelect,
  onEdit,
  onDelete,
}: Omit<SourceRowProps, "expanded" | "onToggleExpanded">) {
  const resolver = resolveEntityName(source.resolver_name, names.resolvers, source.resolver_id)

  return (
    <motion.article
      variants={staggerItem}
      data-id={source.id}
      data-selected={selected}
      className="flex flex-col gap-2 rounded-md border border-line bg-surface-2 p-3 data-[selected=true]:border-[color:var(--accent-line)]"
    >
      <div className="flex items-start gap-2">
        {selectMode ? (
          <span className="flex h-6 items-center">
            <Checkbox
              aria-label={`Select ${source.name}`}
              checked={selected}
              onChange={onToggleSelect}
            />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="text-md font-semibold text-ink [overflow-wrap:anywhere]">{source.name}</div>
          <div className="mt-0.5 text-sm text-ink-muted [overflow-wrap:anywhere]">{resolver}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <AccessButton resourceType="source" id={source.id} label={source.name} />
          <RowActions
            label={`Actions for ${source.name}`}
            actions={sourceActions(onEdit, onDelete)}
          />
        </div>
      </div>
      <div className="border-t border-line-subtle pt-2 text-sm text-ink-muted">
        {usedBy} profile{usedBy === 1 ? "" : "s"} use this resolver
      </div>
      <details className="border-t border-line-subtle pt-2">
        <summary className="tab-stop cursor-pointer text-sm text-ink-muted">Config</summary>
        <div className="mt-2">
          <JsonView value={source.resolver_config ?? {}} label="Resolver config" />
        </div>
      </details>
    </motion.article>
  )
}

export interface SourcesPanelProps {
  /** The page toolbar's shared state — this section has no controls of its own. */
  readonly search: string
  readonly order: ListOrder
  readonly selectMode: boolean
  /** Opens the shared dialog scoped to a source. */
  readonly onCreate: () => void
  readonly onEdit: (source: ResolverSource) => void
}

export function SourcesPanel({ search, order, selectMode, onCreate, onEdit }: SourcesPanelProps) {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<ResolverSource | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set<number>())
  const names = useNameMaps()
  const profiles = useProfiles()

  const usageCounts = useMemo(() => {
    const counts = new Map<number, number>()
    for (const profile of profiles) {
      counts.set(profile.resolver_id, (counts.get(profile.resolver_id) ?? 0) + 1)
    }
    return counts
  }, [profiles])

  const list = useEntityList<ResolverSource>({
    queryKey: queryKeys.sources(),
    fetchPage: (cursor) => fetchSourcePage(cursor),
  })
  const { hasMore, isFetching, loadingAll, loadAll } = list

  const rows = useMemo(
    () => orderRows(rankBySearch(list.items, search, sourceSearchFields), order),
    [list.items, search, order],
  )
  const rowIds = useMemo(() => rows.map((source) => source.id), [rows])

  const selection = useScopedSelection<number>(rowIds)
  const clearSelection = selection.clear
  useEffect(() => {
    // Leaving select mode drops the selection — the checkboxes are gone, so a
    // bulk bar would be describing rows with no visible control.
    if (!selectMode) clearSelection()
  }, [selectMode, clearSelection])

  const selectedSources = rows.filter((source) => selection.has(source.id))
  const access = useBulkAccessAction(
    "source",
    selectedSources.map((source) => ({ id: source.id, label: source.name })),
  )

  const remove = useMutation({
    mutationFn: (id: number) => deleteSource(id),
    onSuccess: (_data, id) => {
      removeFromInfiniteLists(queryClient, queryRoots.sources, id)
      queryClient.removeQueries({ queryKey: queryKeys.source(id) })
      void queryClient.invalidateQueries({ queryKey: queryRoots.sources })
      toast.success("Source deleted")
    },
    onError: (error) => toast.error("Could not delete the source", getErrorMessage(error, "Request failed")),
  })

  const bulkRemove = useMutation({
    mutationFn: async (ids: readonly number[]) => {
      for (const id of ids) await deleteSource(id)
    },
    onSuccess: (_data, ids) => {
      for (const id of ids) {
        removeFromInfiniteLists(queryClient, queryRoots.sources, id)
        queryClient.removeQueries({ queryKey: queryKeys.source(id) })
      }
      void queryClient.invalidateQueries({ queryKey: queryRoots.sources })
      toast.success("Sources deleted", `${ids.length} removed`)
      selection.clear()
    },
    onError: (error) => toast.error("Could not delete the sources", getErrorMessage(error, "Request failed")),
  })

  const toggleExpanded = (id: number): void =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const total = list.items.length
  const filtering = search.trim() !== ""
  const countLabel = filtering ? `${rows.length} of ${total}` : total

  return (
    <Section>
      <ListSectionHead
        title="Sources"
        count={countLabel}
        description="Saved resolver configs. Pick one wherever a resolver asks for a config."
        actions={
          <Button variant="primary" icon={<IconPlus size={16} />} onClick={onCreate}>
            New source
          </Button>
        }
      />

      <QueryState
        query={list}
        loading={<ListSkeleton label="Loading sources" />}
        isEmpty={rows.length === 0}
        empty={
          <EmptyState
            icon={<IconProfiles size={22} />}
            title={total === 0 ? "No sources yet." : "No source matches this search"}
            text={
              total === 0
                ? "A source saves a resolver and its config for reuse."
                : "Clear the search to see every source."
            }
            action={
              total === 0 ? (
                <Button variant="primary" icon={<IconPlus size={16} />} onClick={onCreate}>
                  New source
                </Button>
              ) : undefined
            }
          />
        }
        errorMessage="Could not load sources"
      >
        <Panel>
          <PanelBody flush>
            <div className="hidden min-[672px]:block">
              <Table>
                <thead>
                  <tr>
                    {selectMode ? (
                      <Th className="cell-check">
                        <SelectAllBox
                          label="Select all sources"
                          checked={selection.allSelected(rowIds)}
                          indeterminate={!selection.allSelected(rowIds) && selection.someSelected(rowIds)}
                          onChange={(checked) => selection.setMany(checked ? rowIds : [])}
                        />
                      </Th>
                    ) : null}
                    <Th>Name</Th>
                    <Th>Resolver</Th>
                    <Th num>Used by</Th>
                    <Th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((source) => (
                    <SourceRow
                      key={source.id}
                      source={source}
                      names={names}
                      selectMode={selectMode}
                      selected={selection.has(source.id)}
                      expanded={expanded.has(source.id)}
                      usedBy={usageCounts.get(source.resolver_id) ?? 0}
                      onToggleSelect={() => selection.toggle(source.id)}
                      onToggleExpanded={() => toggleExpanded(source.id)}
                      onEdit={() => onEdit(source)}
                      onDelete={() => setPending(source)}
                    />
                  ))}
                </tbody>
              </Table>
            </div>

            <motion.div
              className="flex flex-col gap-2 p-3 min-[672px]:hidden"
              variants={staggerContainer}
              initial="hidden"
              animate="visible"
            >
              {selectMode ? (
                <div className="flex items-center gap-3 px-1">
                  <SelectAllBox
                    label="Select all sources"
                    checked={selection.allSelected(rowIds)}
                    indeterminate={!selection.allSelected(rowIds) && selection.someSelected(rowIds)}
                    onChange={(checked) => selection.setMany(checked ? rowIds : [])}
                  />
                  <span className="text-sm text-dim">{pluralize(rowIds.length, "source")}</span>
                </div>
              ) : null}
              {rows.map((source) => (
                <SourceCard
                  key={source.id}
                  source={source}
                  names={names}
                  selectMode={selectMode}
                  selected={selection.has(source.id)}
                  usedBy={usageCounts.get(source.resolver_id) ?? 0}
                  onToggleSelect={() => selection.toggle(source.id)}
                  onEdit={() => onEdit(source)}
                  onDelete={() => setPending(source)}
                />
              ))}
            </motion.div>
          </PanelBody>
        </Panel>

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
        open={pending !== null}
        onClose={() => setPending(null)}
        title={pending !== null ? `Delete source “${pending.name}”?` : "Delete source"}
        description="This removes the saved config. Sessions and autoruns already using it keep their own copy."
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

      <ConfirmDialog
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        title={`Delete ${selection.count} selected source${selection.count === 1 ? "" : "s"}?`}
        description="This removes the saved configs. Sessions and autoruns already using them keep their own copy."
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          try {
            await bulkRemove.mutateAsync([...selection.selected])
          } catch {
            // The mutation's onError surfaces the failure via toast.
          }
        }}
      />
    </Section>
  )
}
