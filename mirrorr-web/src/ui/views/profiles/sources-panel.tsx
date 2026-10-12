import { useEffect, useMemo, useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { motion } from "motion/react"
import {
  ApiError,
  createSource,
  deleteSource,
  getErrorMessage,
  removeFromInfiniteLists,
  updateSource,
  useEntityList,
  useNameMaps,
  type NameMaps,
  type SourceBody,
} from "@/api"
import { fetchAllResolvers, fetchSourcePage } from "@/api/endpoints"
import { queryKeys, queryRoots, resolveEntityName, staleTimes } from "@/api/query-keys"
import type { Resolver, ResolverSource } from "@/api/schemas"
import { showingLabel } from "@/ui/lib/format"
import { staggerContainer, staggerItem } from "@/ui/lib/motion"
import {
  Banner,
  BulkBar,
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorPanel,
  Fab,
  Field,
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
  PanelBody,
  SchemaForm,
  Select,
  SkeletonRows,
  Table,
  Td,
  Th,
  asObject,
  defaultsFromSchema,
  toast,
  panelTitleClass,
} from "@/ui/components"
import { useSelection } from "@/ui/hooks"
import { Section } from "@/ui/views/shared/page"
import { DiscoveryDrawer } from "./discovery-drawer"

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
        <div className="flex gap-1 shrink-0">
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

interface SourceDialogProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly source: ResolverSource | null
  readonly resolvers: readonly Resolver[]
  readonly schemasLoading: boolean
  readonly existingNames: readonly { id: number; name: string }[]
}

function SourceDialog({ open, onClose, source, resolvers, schemasLoading, existingNames }: SourceDialogProps) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(source?.name ?? "")
  const [resolverId, setResolverId] = useState(source !== null ? String(source.resolver_id) : "")
  const [resolverConfig, setResolverConfig] = useState<Record<string, unknown>>(source?.resolver_config ?? {})
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({})
  const [browseOpen, setBrowseOpen] = useState(false)

  // Reset the form each time the dialog opens (create after create, or a new row).
  useEffect(() => {
    if (!open) return
    setName(source?.name ?? "")
    setResolverId(source !== null ? String(source.resolver_id) : "")
    setResolverConfig(source?.resolver_config ?? {})
    setError(null)
    setFieldErrors({})
    setBrowseOpen(false)
  }, [open, source])

  const resolver = resolvers.find((item) => String(item.id) === resolverId)
  const canBrowse = resolver !== undefined && Object.keys(asObject(resolver.search_schema)).length > 0

  const duplicate =
    name.trim() !== "" &&
    existingNames.some(
      (item) => item.id !== (source?.id ?? -1) && item.name.toLowerCase() === name.trim().toLowerCase(),
    )

  const save = useMutation({
    mutationFn: (body: SourceBody) => (source === null ? createSource(body) : updateSource(source.id, body)),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: queryRoots.sources })
      void queryClient.invalidateQueries({ queryKey: queryKeys.source(saved.id) })
      toast.success(source === null ? "Source created" : "Source updated", saved.name)
      onClose()
    },
    onError: (caught) => {
      if (caught instanceof ApiError && caught.fieldErrors !== undefined) setFieldErrors(caught.fieldErrors)
      setError(getErrorMessage(caught, "Could not save the source"))
    },
  })

  function changeResolver(nextId: string): void {
    setResolverId(nextId)
    setResolverConfig(defaultsFromSchema(resolvers.find((item) => String(item.id) === nextId)?.config_schema))
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (save.isPending) return
    setError(null)
    setFieldErrors({})
    if (name.trim() === "") {
      setError("Name is required")
      return
    }
    if (resolverId === "") {
      setError("Pick a resolver")
      return
    }
    save.mutate({ name: name.trim(), resolver_id: Number(resolverId), resolver_config: resolverConfig })
  }

  const nameError = duplicate ? "A source with this name already exists." : (fieldErrors.name ?? null)

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={source === null ? "New source" : "Edit source"}
      description="A source saves a resolver and its config, reusable anywhere a resolver is configured."
      busy={save.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="source-form"
            loading={save.isPending}
            disabled={duplicate || name.trim() === ""}
          >
            {source === null ? "Create source" : "Save changes"}
          </Button>
        </>
      }
    >
      <form id="source-form" className="flex flex-col gap-4" onSubmit={onSubmit}>
        {error !== null ? <Banner kind="danger" title={error} /> : null}

        <Field label="Name" htmlFor="source-name" required error={nameError}>
          <Input
            id="source-name"
            value={name}
            autoComplete="off"
            placeholder="e.g. sky-sports-main"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        <Field label="Resolver" htmlFor="source-resolver" required error={fieldErrors.resolver_id ?? null}>
          <Select id="source-resolver" value={resolverId} onChange={(event) => changeResolver(event.target.value)}>
            <option value="">Select a resolver…</option>
            {resolvers.map((item) => (
              <option key={item.id} value={String(item.id)}>
                {item.name}
              </option>
            ))}
          </Select>
        </Field>

        {canBrowse ? (
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              icon={<IconSearch size={15} />}
              onClick={() => setBrowseOpen(true)}
            >
              Browse {resolver.name}…
            </Button>
          </div>
        ) : null}

        <section className="flex flex-col gap-2">
          <h3 className={panelTitleClass}>Resolver config</h3>
          {schemasLoading ? (
            <SkeletonRows rows={3} cols={2} />
          ) : resolver === undefined ? (
            <p className="text-dim" style={{ fontSize: "var(--fs-sm)" }}>
              Pick a resolver to configure it.
            </p>
          ) : (
            <SchemaForm
              schema={resolver.config_schema}
              value={resolverConfig}
              onChange={setResolverConfig}
              idPrefix="source-resolver-config"
            />
          )}
          {fieldErrors.resolver_config !== undefined ? (
            <span className="flex items-center gap-1 text-sm text-danger" role="alert">
              {fieldErrors.resolver_config}
            </span>
          ) : null}
        </section>
      </form>

      <DiscoveryDrawer
        open={browseOpen}
        onClose={() => setBrowseOpen(false)}
        resolver={resolver ?? null}
        onUse={(item) => {
          setResolverConfig(item.config ?? {})
          setBrowseOpen(false)
        }}
      />
    </Dialog>
  )
}

export function SourcesPanel() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ResolverSource | null>(null)
  const [pending, setPending] = useState<ResolverSource | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const selection = useSelection<number>()
  const names = useNameMaps()

  const resolversQuery = useQuery({
    queryKey: queryKeys.resolvers,
    queryFn: () => fetchAllResolvers(),
    staleTime: staleTimes.lookup,
  })

  const list = useEntityList<ResolverSource>({
    queryKey: queryKeys.sources(),
    fetchPage: (cursor) => fetchSourcePage(cursor),
  })
  const { hasMore, isFetching, loadingAll, loadAll } = list

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (term === "") return list.items
    return list.items.filter((source) =>
      [source.name, source.resolver_name ?? ""].join(" ").toLowerCase().includes(term),
    )
  }, [list.items, search])

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

  const openCreate = (): void => {
    setEditing(null)
    setDialogOpen(true)
  }
  const openEdit = (source: ResolverSource): void => {
    setEditing(source)
    setDialogOpen(true)
  }

  const columnCount = 5

  return (
    <Section
      title="Sources"
      description="Saved resolver configs. Pick one wherever a resolver asks for a config."
      actions={
        <Button variant="primary" className="max-sm:hidden" icon={<IconPlus size={16} />} onClick={openCreate}>
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
              <Button variant="primary" icon={<IconPlus size={16} />} onClick={openCreate}>
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
                        onEdit={openEdit}
                        onDelete={setPending}
                      />
                    ))}
                  </tbody>
                </Table>
              </div>
              <motion.div className="cards-mobile hidden max-sm:flex max-sm:flex-col max-sm:gap-3 max-sm:p-3" variants={staggerContainer} initial="hidden" animate="visible">
                {rows.map((source) => (
                  <SourceCard
                    key={source.id}
                    source={source}
                    names={names}
                    selected={selection.has(source.id)}
                    onToggle={selection.toggle}
                    onEdit={openEdit}
                    onDelete={setPending}
                  />
                ))}
              </motion.div>
            </PanelBody>
          </Panel>
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
            count={rows.length}
          />
        </>
      )}

      <Fab label="New source" icon={<IconPlus size={22} />} onClick={openCreate} />

      <SourceDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        source={editing}
        resolvers={resolversQuery.data ?? []}
        schemasLoading={resolversQuery.isLoading}
        existingNames={list.items.map((item) => ({ id: item.id, name: item.name }))}
      />

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
