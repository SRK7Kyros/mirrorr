import { useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { motion } from "motion/react"
import {
  deleteSource,
  getErrorMessage,
  removeFromInfiniteLists,
  useEntityList,
  useNameMaps,
  type NameMaps,
} from "@/api"
import { fetchSourcePage } from "@/api/endpoints"
import { queryKeys, queryRoots, resolveEntityName } from "@/api/query-keys"
import { rankBySearch } from "@/api/domain/search"
import type { ResolverSource } from "@/api/schemas"
import { showingLabel } from "@/ui/lib/format"
import { staggerContainer, staggerItem } from "@/ui/lib/motion"
import { AccessButton, useBulkAccessAction } from "@/ui/views/shared/resource-access-slot"
import {
  BulkBar,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  ErrorPanel,
  IconButton,
  IconEdit,
  IconPlus,
  IconProfiles,
  IconRefresh,
  IconSearch,
  IconTrash,
  Input,
  JsonView,
  LoadMore,
  Panel,
  SelectionHead,
  PanelBody,
  SkeletonRows,
  Table,
  Td,
  Th,
  toast,
} from "@/ui/components"
import { useSelection } from "@/ui/hooks"
import { Section } from "@/ui/views/shared/page"

/**
 * Sources — the "resolver-only profile". A saved `(resolver_id, resolver_config)`
 * pair that can be picked wherever a resolver asks for a config. Same
 * create/update/delete surface as profiles; no engine or retry policy.
 */

interface SourceRowProps {
  readonly source: ResolverSource
  readonly names: NameMaps
  readonly selected: boolean
  readonly onToggle: (id: number) => void
  readonly onEdit: (source: ResolverSource) => void
  readonly onDelete: (source: ResolverSource) => void
}

function SourceRow({ source, names, selected, onToggle, onEdit, onDelete }: SourceRowProps) {
  return (
    <tr data-id={source.id} data-selected={selected}>
      <Td className="cell-check">
        <Checkbox aria-label={`Select ${source.name}`} checked={selected} onChange={() => onToggle(source.id)} />
      </Td>
      <Td>
        <span className="text-truncate" title={source.name}>
          {source.name}
        </span>
      </Td>
      <Td>{resolveEntityName(source.resolver_name, names.resolvers, source.resolver_id)}</Td>
      <Td>
        <JsonView value={source.resolver_config ?? {}} />
      </Td>
      <Td actions>
        <div className="flex items-center gap-3" style={{ gap: "var(--s-2)" }}>
          <AccessButton resourceType="source" id={source.id} label={source.name} />
          <IconButton
            label={`Edit source ${source.name}`}
            icon={<IconEdit size={15} />}
            onClick={() => onEdit(source)}
          />
          <IconButton
            label={`Delete source ${source.name}`}
            icon={<IconTrash size={15} />}
            onClick={() => onDelete(source)}
          />
        </div>
      </Td>
    </tr>
  )
}

function SourceCard({ source, names, selected, onToggle, onEdit, onDelete }: SourceRowProps) {
  return (
    <motion.article className="entity-card flex flex-col gap-3 p-4 border border-line rounded-md bg-surface-2" variants={staggerItem}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3" style={{ gap: "var(--s-2)", minWidth: 0 }}>
          <span className="flex items-center">
            <Checkbox aria-label={`Select ${source.name}`} checked={selected} onChange={() => onToggle(source.id)} />
          </span>
          <div className="text-md font-semibold text-ink [overflow-wrap:anywhere]" title={source.name}>
            {source.name}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <AccessButton resourceType="source" id={source.id} label={source.name} />
          <IconButton
            label={`Edit source ${source.name}`}
            icon={<IconEdit size={15} />}
            onClick={() => onEdit(source)}
          />
          <IconButton
            label={`Delete source ${source.name}`}
            icon={<IconTrash size={15} />}
            onClick={() => onDelete(source)}
          />
        </div>
      </div>
      <dl className="flex flex-col gap-2">
        <div className="entity-card-fact flex flex-col gap-[2px] text-sm [&_dt]:text-ink-dim [&_dd]:text-ink [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere]">
          <dt>Resolver</dt>
          <dd>{resolveEntityName(source.resolver_name, names.resolvers, source.resolver_id)}</dd>
        </div>
        <div className="entity-card-fact flex flex-col gap-[2px] text-sm [&_dt]:text-ink-dim [&_dd]:text-ink [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere]">
          <dt>Config</dt>
          <dd>
            <JsonView value={source.resolver_config ?? {}} />
          </dd>
        </div>
      </dl>
    </motion.article>
  )
}

const sourceSearchFields = (source: ResolverSource): readonly string[] => [
  source.name,
  source.resolver_name ?? "",
]

export interface SourcesPanelProps {
  /** Opens the shared preset dialog on the source tab. */
  readonly onCreate: () => void
  readonly onEdit: (source: ResolverSource) => void
}

export function SourcesPanel({ onCreate, onEdit }: SourcesPanelProps) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")
  const [pending, setPending] = useState<ResolverSource | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const selection = useSelection<number>()
  const names = useNameMaps()

  const list = useEntityList<ResolverSource>({
    queryKey: queryKeys.sources(),
    fetchPage: (cursor) => fetchSourcePage(cursor),
  })
  const { hasMore, isFetching, loadingAll, loadAll } = list

  const rows = useMemo(() => rankBySearch(list.items, search, sourceSearchFields), [list.items, search])
  const selectedSources = list.items.filter((source) => selection.has(source.id))
  const access = useBulkAccessAction(
    "source",
    selectedSources.map((source) => ({ id: source.id, label: source.name })),
  )

  const rowIds = useMemo(() => rows.map((source) => source.id), [rows])

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

  const columnCount = 5

  return (
    <Section
      title="Sources"
      description="Saved resolver configs. Pick one wherever a resolver asks for a config."
      actions={
        <Button variant="primary" className="max-sm:hidden" icon={<IconPlus size={16} />} onClick={onCreate}>
          New source
        </Button>
      }
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-dim" style={{ fontSize: "var(--fs-sm)" }}>
          {showingLabel(rows.length)}
        </span>
        <div className="flex-1" />
        <div className="relative flex-1 min-w-[200px] max-w-[340px] [&_input]:pl-8">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" aria-hidden="true">
            <IconSearch size={15} />
          </span>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter by name or resolver…"
            aria-label="Filter sources"
          />
        </div>
        <Button variant="ghost" size="sm" icon={<IconRefresh size={15} />} loading={isFetching} onClick={list.refetch}>
          Refresh
        </Button>
      </div>

      {list.isLoading ? (
        <Panel>
          <PanelBody>
            <SkeletonRows rows={6} cols={columnCount} />
          </PanelBody>
        </Panel>
      ) : list.isError ? (
        <ErrorPanel message={getErrorMessage(list.error, "Could not load sources")} onRetry={list.refetch} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<IconProfiles size={22} />}
          title={list.items.length === 0 ? "No sources." : "Nothing matches this filter"}
          text={
            list.items.length === 0
              ? "A source saves a resolver and its config for reuse."
              : "Clear the search box to see every source."
          }
          action={
            list.items.length === 0 ? (
              <Button variant="primary" icon={<IconPlus size={16} />} onClick={onCreate}>
                New source
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <Panel>
            <PanelBody flush>
              <div className="table-desktop block max-sm:hidden">
                <Table className="table-stable">
                  <thead>
                    <tr>
                      <Th className="cell-check">
                        <Checkbox
                          aria-label="Select all sources"
                          checked={selection.allSelected(rowIds)}
                          onChange={(event) => selection.setMany(event.target.checked ? rowIds : [])}
                        />
                      </Th>
                      <Th style={{ width: "26%" }}>Name</Th>
                      <Th style={{ width: "22%" }}>Resolver</Th>
                      <Th style={{ width: "44%" }}>Config</Th>
                      <Th aria-label="Actions" style={{ width: "96px" }} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((source) => (
                      <SourceRow
                        key={source.id}
                        source={source}
                        names={names}
                        selected={selection.has(source.id)}
                        onToggle={selection.toggle}
                        onEdit={onEdit}
                        onDelete={setPending}
                      />
                    ))}
                  </tbody>
                </Table>
              </div>
              <motion.div className="cards-mobile hidden max-sm:flex max-sm:flex-col max-sm:gap-3 max-sm:p-3" variants={staggerContainer} initial="hidden" animate="visible">
                <SelectionHead
                  label="Select all sources"
                  checked={selection.allSelected(rows.map((source) => source.id))}
                  onChange={(checked) =>
                    selection.setMany(checked ? rows.map((source) => source.id) : [])
                  }
                  count={rows.length}
                  noun="source"
                />
                {rows.map((source) => (
                  <SourceCard
                    key={source.id}
                    source={source}
                    names={names}
                    selected={selection.has(source.id)}
                    onToggle={selection.toggle}
                    onEdit={onEdit}
                    onDelete={setPending}
                  />
                ))}
              </motion.div>
            </PanelBody>
          </Panel>
          {selection.count > 0 ? (
            <BulkBar
              nextToFab
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
