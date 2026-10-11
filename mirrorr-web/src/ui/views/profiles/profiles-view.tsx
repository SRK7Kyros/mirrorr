import { useEffect, useMemo, useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { motion } from "motion/react"
import {
  ApiError,
  createProfile,
  deleteProfile,
  downloadJson,
  fetchProfileExport,
  getErrorMessage,
  mergeBundles,
  removeFromInfiniteLists,
  updateProfile,
  useEntityList,
  useNameMaps,
  type NameMaps,
  type ProfileBody,
} from "@/api"
import { fetchAllEngines, fetchAllResolvers, fetchProfilePage } from "@/api/endpoints"
import { queryKeys, queryRoots, resolveEntityName, staleTimes } from "@/api/query-keys"
import type { Engine, Profile, Resolver } from "@/api/schemas"
import { humanize, showingLabel } from "@/ui/lib/format"
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
  IconDownload,
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
  Tag,
  Td,
  Th,
  asObject,
  defaultsFromSchema,
  toast,
  panelTitleClass,
} from "@/ui/components"
import { useSelection } from "@/ui/hooks"
import { Page, Section } from "@/ui/views/shared/page"
import { SourcePicker } from "@/ui/views/shared/source-picker"
import { SourcesPanel } from "./sources-panel"

/**
 * Profiles — the one resource here with create + update + delete (spec §5.8).
 * The dialog renders `resolver_config` from the resolver's `config_schema` and
 * the retry params from the engine's `retry_modes_schema`, both plain JSON
 * Schemas, so no plugin-specific fields are hardcoded.
 */

interface ProfileRowProps {
  readonly profile: Profile
  readonly names: NameMaps
  readonly selected: boolean
  readonly onToggle: (id: number) => void
  readonly onEdit: (profile: Profile) => void
  readonly onDelete: (profile: Profile) => void
  readonly onExport: (profile: Profile) => void
}

function ProfileRow({ profile, names, selected, onToggle, onEdit, onDelete, onExport }: ProfileRowProps) {
  return (
    <tr data-id={profile.id} data-selected={selected}>
      <Td className="cell-check">
        <Checkbox
          aria-label={`Select ${profile.name}`}
          checked={selected}
          onChange={() => onToggle(profile.id)}
        />
      </Td>
      <Td>
        <span className="text-truncate" title={profile.name}>
          {profile.name}
        </span>
      </Td>
      <Td>
        {resolveEntityName(profile.resolver_name, names.resolvers, profile.resolver_id)}
        <span className="text-dim" aria-hidden="true">
          {" → "}
        </span>
        {resolveEntityName(profile.engine_name, names.engines, profile.default_engine_id)}
      </Td>
      <Td>
        {profile.retry_mode !== undefined && profile.retry_mode !== "" ? (
          <Tag accent>{humanize(profile.retry_mode)}</Tag>
        ) : (
          <span className="text-dim">No retry</span>
        )}
      </Td>
      <Td>
        <JsonView value={profile.resolver_config ?? {}} />
      </Td>
      <Td actions>
        <div className="flex items-center gap-3" style={{ gap: "var(--s-2)" }}>
          <IconButton
            label={`Export profile ${profile.name}`}
            icon={<IconDownload size={15} />}
            onClick={() => onExport(profile)}
          />
          <IconButton
            label={`Edit profile ${profile.name}`}
            icon={<IconEdit size={15} />}
            onClick={() => onEdit(profile)}
          />
          <IconButton
            label={`Delete profile ${profile.name}`}
            icon={<IconTrash size={15} />}
            onClick={() => onDelete(profile)}
          />
        </div>
      </Td>
    </tr>
  )
}

function ProfileCard({ profile, names, selected, onToggle, onEdit, onDelete, onExport }: ProfileRowProps) {
  return (
    <motion.article className="entity-card" variants={staggerItem}>
      <div className="entity-card-head">
        <div className="flex items-center gap-3" style={{ gap: "var(--s-2)", minWidth: 0 }}>
          <span className="entity-card-check">
            <Checkbox
              aria-label={`Select ${profile.name}`}
              checked={selected}
              onChange={() => onToggle(profile.id)}
            />
          </span>
          <div className="entity-card-title" title={profile.name}>
            {profile.name}
          </div>
        </div>
        <div className="entity-card-actions">
          <IconButton
            label={`Export profile ${profile.name}`}
            icon={<IconDownload size={15} />}
            onClick={() => onExport(profile)}
          />
          <IconButton
            label={`Edit profile ${profile.name}`}
            icon={<IconEdit size={15} />}
            onClick={() => onEdit(profile)}
          />
          <IconButton
            label={`Delete profile ${profile.name}`}
            icon={<IconTrash size={15} />}
            onClick={() => onDelete(profile)}
          />
        </div>
      </div>
      <dl className="entity-card-facts">
        <div className="entity-card-fact">
          <dt>Resolver → Engine</dt>
          <dd>
            {resolveEntityName(profile.resolver_name, names.resolvers, profile.resolver_id)}
            <span className="text-dim" aria-hidden="true">
              {" → "}
            </span>
            {resolveEntityName(profile.engine_name, names.engines, profile.default_engine_id)}
          </dd>
        </div>
        <div className="entity-card-fact">
          <dt>Retry</dt>
          <dd>
            {profile.retry_mode !== undefined && profile.retry_mode !== "" ? (
              <Tag accent>{humanize(profile.retry_mode)}</Tag>
            ) : (
              <span className="text-dim">No retry</span>
            )}
          </dd>
        </div>
        <div className="entity-card-fact">
          <dt>Config</dt>
          <dd>
            <JsonView value={profile.resolver_config ?? {}} />
          </dd>
        </div>
      </dl>
    </motion.article>
  )
}

interface ProfileDialogProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly profile: Profile | null
  readonly engines: readonly Engine[]
  readonly resolvers: readonly Resolver[]
  readonly schemasLoading: boolean
  readonly existingNames: readonly { id: number; name: string }[]
}

function ProfileDialog({
  open,
  onClose,
  profile,
  engines,
  resolvers,
  schemasLoading,
  existingNames,
}: ProfileDialogProps) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(profile?.name ?? "")
  const [engineId, setEngineId] = useState(profile !== null ? String(profile.default_engine_id) : "")
  const [resolverId, setResolverId] = useState(profile !== null ? String(profile.resolver_id) : "")
  const [resolverConfig, setResolverConfig] = useState<Record<string, unknown>>(profile?.resolver_config ?? {})
  const [retryMode, setRetryMode] = useState(profile?.retry_mode ?? "")
  const [retryConfig, setRetryConfig] = useState<Record<string, unknown>>(profile?.retry_config ?? {})
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({})

  // Reset the form each time the dialog opens (create after create, or a
  // different row) — `profile` identity is stable while the dialog is open.
  useEffect(() => {
    if (!open) return
    setName(profile?.name ?? "")
    setEngineId(profile !== null ? String(profile.default_engine_id) : "")
    setResolverId(profile !== null ? String(profile.resolver_id) : "")
    setResolverConfig(profile?.resolver_config ?? {})
    setRetryMode(profile?.retry_mode ?? "")
    setRetryConfig(profile?.retry_config ?? {})
    setError(null)
    setFieldErrors({})
  }, [open, profile])

  const engine = engines.find((item) => String(item.id) === engineId)
  const resolver = resolvers.find((item) => String(item.id) === resolverId)
  const retryModes = asObject(engine?.retry_modes_schema)
  const retryModeKeys = Object.keys(retryModes)
  const retryEntry = asObject(retryModeKeys.includes(retryMode) ? retryModes[retryMode] : undefined)
  const retrySchema = asObject(retryEntry["schema"])

  const duplicate =
    name.trim() !== "" &&
    existingNames.some(
      (item) => item.id !== (profile?.id ?? -1) && item.name.toLowerCase() === name.trim().toLowerCase(),
    )

  const save = useMutation({
    mutationFn: (body: ProfileBody) => (profile === null ? createProfile(body) : updateProfile(profile.id, body)),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: queryRoots.profiles })
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile(saved.id) })
      toast.success(profile === null ? "Profile created" : "Profile updated", saved.name)
      onClose()
    },
    onError: (caught) => {
      if (caught instanceof ApiError && caught.fieldErrors !== undefined) setFieldErrors(caught.fieldErrors)
      setError(getErrorMessage(caught, "Could not save the profile"))
    },
  })

  function changeEngine(nextId: string): void {
    setEngineId(nextId)
    setRetryMode("")
    setRetryConfig({})
  }

  function changeResolver(nextId: string): void {
    setResolverId(nextId)
    setResolverConfig(defaultsFromSchema(resolvers.find((item) => String(item.id) === nextId)?.config_schema))
  }

  function changeRetryMode(nextMode: string): void {
    setRetryMode(nextMode)
    setRetryConfig(asObject(asObject(retryModes[nextMode])["default_params"]))
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
    if (engineId === "" || resolverId === "") {
      setError("Pick an engine and a resolver")
      return
    }
    save.mutate({
      name: name.trim(),
      default_engine_id: Number(engineId),
      resolver_id: Number(resolverId),
      resolver_config: resolverConfig,
      ...(retryMode === "" ? {} : { retry_mode: retryMode, retry_config: retryConfig }),
    })
  }

  const nameError = duplicate
    ? "A profile with this name already exists."
    : (fieldErrors.name ?? null)
  const engineError = fieldErrors.default_engine_id ?? fieldErrors.engine_id ?? null
  const resolverError = fieldErrors.resolver_id ?? null

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={profile === null ? "New profile" : "Edit profile"}
      description="A profile saves an engine, resolver and retry policy for reuse."
      busy={save.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="profile-form"
            loading={save.isPending}
            disabled={duplicate || name.trim() === ""}
          >
            {profile === null ? "Create profile" : "Save changes"}
          </Button>
        </>
      }
    >
      <form id="profile-form" className="flex flex-col gap-4" onSubmit={onSubmit}>
        {error !== null ? <Banner kind="danger" title={error} /> : null}

        <Field label="Name" htmlFor="profile-name" required error={nameError}>
          <Input
            id="profile-name"
            value={name}
            autoComplete="off"
            placeholder="e.g. nightly-news"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-5 max-sm:grid-cols-1">
          <Field label="Engine" htmlFor="profile-engine" required error={engineError}>
            <Select id="profile-engine" value={engineId} onChange={(event) => changeEngine(event.target.value)}>
              <option value="">Select an engine…</option>
              {engines.map((item) => (
                <option key={item.id} value={String(item.id)}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Resolver" htmlFor="profile-resolver" required error={resolverError}>
            <Select id="profile-resolver" value={resolverId} onChange={(event) => changeResolver(event.target.value)}>
              <option value="">Select a resolver…</option>
              {resolvers.map((item) => (
                <option key={item.id} value={String(item.id)}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <SourcePicker
          idPrefix="profile"
          resolverId={resolverId}
          onPick={(source) => {
            setResolverId(String(source.resolver_id))
            setResolverConfig(source.resolver_config ?? {})
          }}
        />

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
              idPrefix="profile-resolver-config"
            />
          )}
          {fieldErrors.resolver_config !== undefined ? (
            <span className="flex items-center gap-1 text-sm text-danger" role="alert">
              {fieldErrors.resolver_config}
            </span>
          ) : null}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className={panelTitleClass}>Retry policy</h3>
          {engine === undefined ? (
            <p className="text-dim" style={{ fontSize: "var(--fs-sm)" }}>
              Pick an engine to configure retries.
            </p>
          ) : retryModeKeys.length === 0 ? (
            <p className="text-dim" style={{ fontSize: "var(--fs-sm)" }}>
              This engine declares no retry modes.
            </p>
          ) : (
            <>
              <Field label="Mode" htmlFor="profile-retry-mode" error={fieldErrors.retry_mode ?? null}>
                <Select
                  id="profile-retry-mode"
                  value={retryMode}
                  onChange={(event) => changeRetryMode(event.target.value)}
                >
                  <option value="">No retry</option>
                  {retryModeKeys.map((key) => (
                    <option key={key} value={key}>
                      {humanize(key)}
                    </option>
                  ))}
                </Select>
              </Field>
              {retryMode !== "" ? (
                <SchemaForm
                  schema={retrySchema}
                  value={retryConfig}
                  onChange={setRetryConfig}
                  idPrefix="profile-retry-config"
                />
              ) : null}
              {fieldErrors.retry_config !== undefined ? (
                <span className="flex items-center gap-1 text-sm text-danger" role="alert">
                  {fieldErrors.retry_config}
                </span>
              ) : null}
            </>
          )}
        </section>
      </form>
    </Dialog>
  )
}

export function ProfilesView() {
  return (
    <Page title="Presets" description="Reusable profiles and saved resolver configs.">
      <ProfilesPanel />
      <SourcesPanel />
    </Page>
  )
}

function ProfilesPanel() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Profile | null>(null)
  const [pending, setPending] = useState<Profile | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const selection = useSelection<number>()
  const names = useNameMaps()

  const enginesQuery = useQuery({
    queryKey: queryKeys.engines,
    queryFn: () => fetchAllEngines(),
    staleTime: staleTimes.lookup,
  })
  const resolversQuery = useQuery({
    queryKey: queryKeys.resolvers,
    queryFn: () => fetchAllResolvers(),
    staleTime: staleTimes.lookup,
  })

  const list = useEntityList<Profile>({
    queryKey: queryKeys.profiles(),
    fetchPage: (cursor) => fetchProfilePage(cursor),
  })
  const { hasMore, isFetching, loadingAll, loadAll } = list

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (term === "") return list.items
    return list.items.filter((profile) =>
      [profile.name, profile.engine_name ?? "", profile.resolver_name ?? "", profile.retry_mode ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(term),
    )
  }, [list.items, search])

  const rowIds = useMemo(() => rows.map((profile) => profile.id), [rows])

  const remove = useMutation({
    mutationFn: (id: number) => deleteProfile(id),
    onSuccess: (_data, id) => {
      removeFromInfiniteLists(queryClient, queryRoots.profiles, id)
      queryClient.removeQueries({ queryKey: queryKeys.profile(id) })
      void queryClient.invalidateQueries({ queryKey: queryRoots.profiles })
      toast.success("Profile deleted")
    },
    onError: (error) => toast.error("Could not delete the profile", getErrorMessage(error, "Request failed")),
  })

  const exportProfile = useMutation({
    mutationFn: (profile: Profile) => fetchProfileExport(profile.id),
    onSuccess: (bundle, profile) => {
      if (downloadJson(`${profile.name}.json`, bundle)) toast.success("Profile exported", profile.name)
      else toast.error("Export failed", "The download could not be started.")
    },
    onError: (error) => toast.error("Could not export the profile", getErrorMessage(error, "Request failed")),
  })

  const bulkRemove = useMutation({
    mutationFn: async (ids: readonly number[]) => {
      for (const id of ids) await deleteProfile(id)
    },
    onSuccess: (_data, ids) => {
      for (const id of ids) {
        removeFromInfiniteLists(queryClient, queryRoots.profiles, id)
        queryClient.removeQueries({ queryKey: queryKeys.profile(id) })
      }
      void queryClient.invalidateQueries({ queryKey: queryRoots.profiles })
      toast.success("Profiles deleted", `${ids.length} removed`)
      selection.clear()
    },
    onError: (error) => toast.error("Could not delete the profiles", getErrorMessage(error, "Request failed")),
  })

  const bulkExport = useMutation({
    mutationFn: async (targets: readonly Profile[]) => {
      const bundles = await Promise.all(targets.map((target) => fetchProfileExport(target.id)))
      return mergeBundles(bundles)
    },
    onSuccess: (bundle, targets) => {
      if (downloadJson(`profiles-${targets.length}.json`, bundle)) {
        toast.success("Profiles exported", `${targets.length} bundled`)
        selection.clear()
      } else {
        toast.error("Export failed", "The download could not be started.")
      }
    },
    onError: (error) => toast.error("Could not export the profiles", getErrorMessage(error, "Request failed")),
  })

  const selectedProfiles = list.items.filter((profile) => selection.has(profile.id))

  const openCreate = (): void => {
    setEditing(null)
    setDialogOpen(true)
  }
  const openEdit = (profile: Profile): void => {
    setEditing(profile)
    setDialogOpen(true)
  }

  const columnCount = 6

  return (
    <Section
      title="Profiles"
      description="Reusable engine + resolver + retry presets. Start a session or autorun from one."
      actions={
        <Button variant="primary" className="max-sm:hidden" icon={<IconPlus size={16} />} onClick={openCreate}>
          New profile
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
            placeholder="Filter by name, engine, resolver…"
            aria-label="Filter profiles"
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
        <ErrorPanel message={getErrorMessage(list.error, "Could not load profiles")} onRetry={list.refetch} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<IconProfiles size={22} />}
          title={list.items.length === 0 ? "No profiles." : "Nothing matches this filter"}
          text={
            list.items.length === 0
              ? "A profile saves engine, resolver and retry policy for reuse."
              : "Clear the search box to see every profile."
          }
          action={
            list.items.length === 0 ? (
              <Button variant="primary" icon={<IconPlus size={16} />} onClick={openCreate}>
                New profile
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <Panel>
            <PanelBody flush>
              <div className="table-desktop">
                <Table className="table-stable">
                  <thead>
                    <tr>
                      <Th className="cell-check">
                        <Checkbox
                          aria-label="Select all profiles"
                          checked={selection.allSelected(rowIds)}
                          onChange={(event) => selection.setMany(event.target.checked ? rowIds : [])}
                        />
                      </Th>
                      <Th style={{ width: "20%" }}>Name</Th>
                      <Th style={{ width: "24%" }}>Resolver → Engine</Th>
                      <Th style={{ width: "12%" }}>Retry</Th>
                      <Th style={{ width: "32%" }}>Config</Th>
                      <Th aria-label="Actions" style={{ width: "108px" }} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((profile) => (
                      <ProfileRow
                        key={profile.id}
                        profile={profile}
                        names={names}
                        selected={selection.has(profile.id)}
                        onToggle={selection.toggle}
                        onEdit={openEdit}
                        onDelete={setPending}
                        onExport={(target) => exportProfile.mutate(target)}
                      />
                    ))}
                  </tbody>
                </Table>
              </div>
              <motion.div className="cards-mobile" variants={staggerContainer} initial="hidden" animate="visible">
                {rows.map((profile) => (
                  <ProfileCard
                    key={profile.id}
                    profile={profile}
                    names={names}
                    selected={selection.has(profile.id)}
                    onToggle={selection.toggle}
                    onEdit={openEdit}
                    onDelete={setPending}
                    onExport={(target) => exportProfile.mutate(target)}
                  />
                ))}
              </motion.div>
            </PanelBody>
          </Panel>
          {selection.count > 0 ? (
            <BulkBar count={selection.count} onClear={selection.clear}>
              <Button
                size="sm"
                variant="outline"
                icon={<IconDownload size={15} />}
                loading={bulkExport.isPending}
                onClick={() => bulkExport.mutate(selectedProfiles)}
              >
                Export selected
              </Button>
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

      <Fab label="New profile" icon={<IconPlus size={22} />} onClick={openCreate} />

      <ProfileDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        profile={editing}
        engines={enginesQuery.data ?? []}
        resolvers={resolversQuery.data ?? []}
        schemasLoading={enginesQuery.isLoading || resolversQuery.isLoading}
        existingNames={list.items.map((item) => ({ id: item.id, name: item.name }))}
      />

      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title={pending !== null ? `Delete profile “${pending.name}”?` : "Delete profile"}
        description="Profiles in use by autoruns or sessions cannot be deleted — remove those references first."
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
        title={`Delete ${selection.count} selected profile${selection.count === 1 ? "" : "s"}?`}
        description="Profiles in use by autoruns or sessions cannot be deleted — remove those references first."
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
