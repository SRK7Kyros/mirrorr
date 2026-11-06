import { useEffect, useId, useMemo, useState } from "react"
import { useIsFetching, useMutation, useQueryClient } from "@tanstack/react-query"
import { motion } from "motion/react"
import {
  deleteProfile,
  downloadJson,
  fetchProfileExport,
  getErrorMessage,
  mergeBundles,
  removeFromInfiniteLists,
  useEntityList,
  useNameMaps,
  type NameMaps,
} from "@/api"
import { fetchProfilePage } from "@/api/endpoints"
import { queryKeys, queryRoots, resolveEntityName } from "@/api/query-keys"
import { rankBySearch } from "@/api/domain/search"
import { flaggedNotice } from "@/api/domain/autorun-issue"
import { chainOf, mapNaming, rungLabel } from "@/api/domain/fallback-chain"
import type { Profile, ResolverSource } from "@/api/schemas"
import { humanize, pluralize } from "@/ui/lib/format"
import { staggerContainer, staggerItem } from "@/ui/lib/motion"
import { AccessButton, useBulkAccessAction } from "@/ui/views/shared/resource-access-slot"
import {
  BulkBar,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  IconButton,
  IconDownload,
  IconPlus,
  IconProfiles,
  IconRefresh,
  IconSearch,
  IconTrash,
  Input,
  JsonView,
  LoadMore,
  PageToolbar,
  Panel,
  PanelBody,
  QueryState,
  RowActions,
  Select,
  Table,
  Tag,
  Td,
  Th,
  toast,
} from "@/ui/components"
import { useScopedSelection } from "@/ui/hooks"
import { Page, Section } from "@/ui/views/shared/page"
import { SourcesPanel } from "./sources-panel"
import { PresetsDialog, type PresetKind } from "./presets-dialog"
import {
  ConfigRow,
  DisclosureToggle,
  LIST_ORDERS,
  ListSectionHead,
  ListSkeleton,
  SelectAllBox,
  orderRows,
  type ListOrder,
} from "@/ui/views/shared/list-rows"

/**
 * Profiles and Sources — one page, two stacked sections (they were tabs once and
 * were deliberately split back out), one toolbar, and one primary action.
 *
 * The page owns what the two lists have in common — the search term, the sort
 * order and the select mode — because two toolbars is exactly the defect this
 * phase removed: each panel used to carry its own search box, its own refresh
 * and its own loose count, so "filter" meant two different things on one screen.
 * Each panel still owns its rows, its selection and its mutations, because a
 * profile and a source are deleted by different endpoints with different
 * consequences.
 */

interface ProfileRowProps {
  readonly profile: Profile
  readonly names: NameMaps
  readonly selectMode: boolean
  readonly selected: boolean
  readonly expanded: boolean
  readonly onToggleSelect: () => void
  readonly onToggleExpanded: () => void
  readonly onEdit: () => void
  readonly onDelete: () => void
  readonly onExport: () => void
}

function profileFallbacks(profile: Profile, names: NameMaps): string[] {
  const naming = mapNaming({
    engines: names.engines ?? new Map<number, string>(),
    resolvers: names.resolvers ?? new Map<number, string>(),
    profiles: names.profiles ?? new Map<number, string>(),
  })
  return chainOf(profile).map((rung) => rungLabel(rung, naming))
}

/** Retry mode when set; an empty cell is the honest "no policy" (the old column printed "No retry"). */
function RetryTag({ profile }: { readonly profile: Profile }) {
  if (profile.retry_mode === undefined || profile.retry_mode === "") return null
  return <Tag accent>{humanize(profile.retry_mode)}</Tag>
}

/** The row's overflow: everything the three naked glyphs used to carry. */
function profileActions(onEdit: () => void, onDelete: () => void) {
  return [
    { label: "Edit", onSelect: onEdit },
    { label: "Delete", danger: true, separatorBefore: true, onSelect: onDelete },
  ] as const
}

function ProfileRow({
  profile,
  names,
  selectMode,
  selected,
  expanded,
  onToggleSelect,
  onToggleExpanded,
  onEdit,
  onDelete,
  onExport,
}: ProfileRowProps) {
  const configId = useId()
  const fallbacks = profileFallbacks(profile, names)
  const engine = resolveEntityName(profile.engine_name, names.engines, profile.default_engine_id)
  const resolver = resolveEntityName(profile.resolver_name, names.resolvers, profile.resolver_id)
  const fallbackTitle =
    fallbacks.length === 0
      ? "Fallbacks: none — this profile's own source only"
      : `Fallbacks: ${fallbacks.join(" → ")}`

  return (
    <>
      <tr data-id={profile.id} data-selected={selected}>
        {selectMode ? (
          <Td className="cell-check">
            <Checkbox
              aria-label={`Select ${profile.name}`}
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
              label={`${expanded ? "Hide" : "Show"} config for ${profile.name}`}
              onToggle={onToggleExpanded}
            />
            <span className="truncate" title={profile.name}>
              {profile.name}
            </span>
          </div>
        </Td>
        <Td>
          <span className="text-ink-muted">
            {engine}
            <span className="text-dim" aria-hidden="true">
              {" → "}
            </span>
            {resolver}
          </span>
        </Td>
        <Td num title={fallbackTitle}>
          {1 + fallbacks.length}
        </Td>
        <Td>
          <RetryTag profile={profile} />
        </Td>
        <Td actions>
          <div className="flex items-center justify-end gap-1">
            <AccessButton resourceType="profile" id={profile.id} label={profile.name} />
            <IconButtonExport profile={profile} onExport={onExport} />
            <RowActions
              label={`Actions for ${profile.name}`}
              actions={profileActions(onEdit, onDelete)}
            />
          </div>
        </Td>
      </tr>
      {expanded ? (
        <ConfigRow id={configId} columns={selectMode ? 6 : 5}>
          <div className="flex flex-col gap-2">
            <JsonView value={profile.resolver_config ?? {}} label="Resolver config" />
            {profile.retry_config !== undefined && Object.keys(profile.retry_config).length > 0 ? (
              <JsonView value={profile.retry_config} label="Retry config" />
            ) : null}
          </div>
        </ConfigRow>
      ) : null}
    </>
  )
}

function IconButtonExport({ profile, onExport }: { readonly profile: Profile; readonly onExport: () => void }) {
  return (
    // `md` is the row's action size — the same box as `Access` and `⋯` beside
    // it, so a stretch row lines all three up on one baseline.
    <IconButton
      variant="ghost"
      size="md"
      icon={<IconDownload size={15} />}
      label={`Export profile ${profile.name}`}
      onClick={onExport}
    />
  )
}

function ProfileCard({
  profile,
  names,
  selectMode,
  selected,
  onToggleSelect,
  onEdit,
  onDelete,
  onExport,
}: Omit<ProfileRowProps, "expanded" | "onToggleExpanded">) {
  const fallbacks = profileFallbacks(profile, names)
  const engine = resolveEntityName(profile.engine_name, names.engines, profile.default_engine_id)
  const resolver = resolveEntityName(profile.resolver_name, names.resolvers, profile.resolver_id)

  return (
    <motion.article
      variants={staggerItem}
      data-id={profile.id}
      data-selected={selected}
      className="flex flex-col gap-2 rounded-md border border-line bg-surface-2 p-3 data-[selected=true]:border-[color:var(--accent-line)]"
    >
      <div className="flex items-start gap-2">
        {selectMode ? (
          <span className="flex h-6 items-center">
            <Checkbox
              aria-label={`Select ${profile.name}`}
              checked={selected}
              onChange={onToggleSelect}
            />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="text-md font-semibold text-ink [overflow-wrap:anywhere]">{profile.name}</div>
          <div className="mt-0.5 text-sm text-ink-muted [overflow-wrap:anywhere]">
            {engine}
            <span className="text-dim" aria-hidden="true">
              {" → "}
            </span>
            {resolver}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <AccessButton resourceType="profile" id={profile.id} label={profile.name} />
          <IconButtonExport profile={profile} onExport={onExport} />
          <RowActions
            label={`Actions for ${profile.name}`}
            actions={profileActions(onEdit, onDelete)}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
        <span title={fallbacks.length === 0 ? "Fallbacks: none" : `Fallbacks: ${fallbacks.join(" → ")}`}>
          {1 + fallbacks.length} source{fallbacks.length === 0 ? "" : "s"}
        </span>
        {profile.retry_mode !== undefined && profile.retry_mode !== "" ? (
          <>
            <span className="text-dim" aria-hidden="true">
              ·
            </span>
            <RetryTag profile={profile} />
          </>
        ) : null}
      </div>
      <details className="border-t border-line-subtle pt-2">
        <summary className="tab-stop cursor-pointer text-sm text-ink-muted">Config</summary>
        <div className="mt-2 flex flex-col gap-2">
          <JsonView value={profile.resolver_config ?? {}} label="Resolver config" />
          {profile.retry_config !== undefined && Object.keys(profile.retry_config).length > 0 ? (
            <JsonView value={profile.retry_config} label="Retry config" />
          ) : null}
        </div>
      </details>
    </motion.article>
  )
}

/** What the page's primary action (or a section button) opened. */
interface PresetDialogTarget {
  readonly kind: PresetKind
  readonly profile: Profile | null
  readonly source: ResolverSource | null
}

const profileSearchFields = (profile: Profile): readonly string[] => [
  profile.name,
  profile.engine_name ?? "",
  profile.resolver_name ?? "",
  profile.retry_mode ?? "",
]

function SearchField({ value, onChange }: { readonly value: string; readonly onChange: (value: string) => void }) {
  return (
    <div className="relative min-w-0 [&_input]:pl-8">
      <span
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
        aria-hidden="true"
      >
        <IconSearch size={15} />
      </span>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search profiles and sources"
        aria-label="Search profiles and sources"
      />
    </div>
  )
}

export function ProfilesView() {
  const [target, setTarget] = useState<PresetDialogTarget | null>(null)
  const [search, setSearch] = useState("")
  const [order, setOrder] = useState<ListOrder>("newest")
  const [selectMode, setSelectMode] = useState(false)
  const queryClient = useQueryClient()
  const fetching = useIsFetching({ queryKey: queryRoots.profiles }) + useIsFetching({ queryKey: queryRoots.sources })

  const create = (kind: PresetKind): void => setTarget({ kind, profile: null, source: null })
  const editProfile = (profile: Profile): void => setTarget({ kind: "profile", profile, source: null })
  const editSource = (source: ResolverSource): void => setTarget({ kind: "source", profile: null, source })

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: queryRoots.profiles })
    void queryClient.invalidateQueries({ queryKey: queryRoots.sources })
  }

  return (
    <Page
      title="Profiles & sources"
      description="A profile picks an engine and a source; a source saves a resolver and its config."
      actions={
        <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => create("profile")}>
          New profile
        </Button>
      }
    >
      <PageToolbar
        search={<SearchField value={search} onChange={setSearch} />}
        sort={
          <Select
            aria-label="Sort profiles and sources"
            className="w-auto max-w-[180px]"
            value={order}
            onChange={(event) => setOrder(event.target.value as ListOrder)}
          >
            {LIST_ORDERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        }
        select={
          <Button
            variant={selectMode ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={selectMode}
            onClick={() => setSelectMode((current) => !current)}
          >
            Select
          </Button>
        }
        refresh={
          <Button
            variant="ghost"
            size="sm"
            icon={<IconRefresh size={15} />}
            loading={fetching > 0}
            onClick={refresh}
          >
            Refresh
          </Button>
        }
      />

      <ProfilesPanel
        search={search}
        order={order}
        selectMode={selectMode}
        onCreate={() => create("profile")}
        onEdit={editProfile}
      />
      <SourcesPanel
        search={search}
        order={order}
        selectMode={selectMode}
        onCreate={() => create("source")}
        onEdit={editSource}
      />

      <PresetsDialog
        open={target !== null}
        kind={target?.kind ?? "profile"}
        // Nothing on this page creates "something, choose what" any more: the
        // page head makes profiles and the Sources head makes sources, so the
        // dialog is always scoped to the kind its trigger named.
        allowKindSwitch={false}
        profile={target?.profile ?? null}
        source={target?.source ?? null}
        onClose={() => setTarget(null)}
      />
    </Page>
  )
}

function ProfilesPanel({
  search,
  order,
  selectMode,
  onCreate,
  onEdit,
}: {
  readonly search: string
  readonly order: ListOrder
  readonly selectMode: boolean
  readonly onCreate: () => void
  readonly onEdit: (profile: Profile) => void
}) {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<Profile | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set<number>())
  const names = useNameMaps()

  const list = useEntityList<Profile>({
    queryKey: queryKeys.profiles(),
    fetchPage: (cursor) => fetchProfilePage(cursor),
  })
  const { hasMore, isFetching, loadingAll, loadAll } = list

  const rows = useMemo(
    () => orderRows(rankBySearch(list.items, search, profileSearchFields), order),
    [list.items, search, order],
  )
  const rowIds = useMemo(() => rows.map((profile) => profile.id), [rows])

  const selection = useScopedSelection<number>(rowIds)
  const clearSelection = selection.clear
  useEffect(() => {
    // Leaving select mode leaves nothing selected: the checkboxes are gone, so a
    // bar that still says "3 selected" would be describing rows nobody can see
    // a control for.
    if (!selectMode) clearSelection()
  }, [selectMode, clearSelection])

  const remove = useMutation({
    mutationFn: (id: number) => deleteProfile(id),
    onSuccess: (counts, id) => {
      removeFromInfiniteLists(queryClient, queryRoots.profiles, id)
      queryClient.removeQueries({ queryKey: queryKeys.profile(id) })
      void queryClient.invalidateQueries({ queryKey: queryRoots.profiles })
      void queryClient.invalidateQueries({ queryKey: queryRoots.autoruns })
      const flagged = flaggedNotice(counts.flagged ?? 0)
      if (flagged === "") toast.success("Profile deleted")
      else toast.warning("Profile deleted", flagged)
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
      let flagged = 0
      for (const id of ids) {
        const counts = await deleteProfile(id)
        flagged += counts.flagged ?? 0
      }
      return flagged
    },
    onSuccess: (flagged, ids) => {
      for (const id of ids) {
        removeFromInfiniteLists(queryClient, queryRoots.profiles, id)
        queryClient.removeQueries({ queryKey: queryKeys.profile(id) })
      }
      void queryClient.invalidateQueries({ queryKey: queryRoots.profiles })
      void queryClient.invalidateQueries({ queryKey: queryRoots.autoruns })
      const notice = flaggedNotice(flagged)
      if (notice === "") toast.success("Profiles deleted", `${ids.length} removed`)
      else toast.warning("Profiles deleted", `${ids.length} removed. ${notice}`)
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

  const selectedProfiles = rows.filter((profile) => selection.has(profile.id))
  const access = useBulkAccessAction(
    "profile",
    selectedProfiles.map((profile) => ({ id: profile.id, label: profile.name })),
  )

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
        title="Profiles"
        count={countLabel}
        description="Reusable engine, source and retry config. Start a session or autorun from one."
      />

      <QueryState
        query={list}
        loading={<ListSkeleton label="Loading profiles" />}
        isEmpty={rows.length === 0}
        empty={
          <EmptyState
            icon={<IconProfiles size={22} />}
            title={total === 0 ? "No profiles yet." : "No profile matches this search"}
            text={
              total === 0
                ? "A profile saves an engine, a source and a retry policy for reuse."
                : "Clear the search to see every profile."
            }
            action={
              total === 0 ? (
                <Button variant="primary" icon={<IconPlus size={16} />} onClick={onCreate}>
                  New profile
                </Button>
              ) : undefined
            }
          />
        }
        errorMessage="Could not load profiles"
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
                          label="Select all profiles"
                          checked={selection.allSelected(rowIds)}
                          indeterminate={!selection.allSelected(rowIds) && selection.someSelected(rowIds)}
                          onChange={(checked) => selection.setMany(checked ? rowIds : [])}
                        />
                      </Th>
                    ) : null}
                    <Th>Name</Th>
                    <Th>Engine → Resolver</Th>
                    <Th num>Sources used</Th>
                    <Th>Retry</Th>
                    <Th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((profile) => (
                    <ProfileRow
                      key={profile.id}
                      profile={profile}
                      names={names}
                      selectMode={selectMode}
                      selected={selection.has(profile.id)}
                      expanded={expanded.has(profile.id)}
                      onToggleSelect={() => selection.toggle(profile.id)}
                      onToggleExpanded={() => toggleExpanded(profile.id)}
                      onEdit={() => onEdit(profile)}
                      onDelete={() => setPending(profile)}
                      onExport={() => exportProfile.mutate(profile)}
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
                    label="Select all profiles"
                    checked={selection.allSelected(rowIds)}
                    indeterminate={!selection.allSelected(rowIds) && selection.someSelected(rowIds)}
                    onChange={(checked) => selection.setMany(checked ? rowIds : [])}
                  />
                  <span className="text-sm text-dim">{pluralize(rowIds.length, "profile")}</span>
                </div>
              ) : null}
              {rows.map((profile) => (
                <ProfileCard
                  key={profile.id}
                  profile={profile}
                  names={names}
                  selectMode={selectMode}
                  selected={selection.has(profile.id)}
                  onToggleSelect={() => selection.toggle(profile.id)}
                  onEdit={() => onEdit(profile)}
                  onDelete={() => setPending(profile)}
                  onExport={() => exportProfile.mutate(profile)}
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
                key: "export",
                label: "Export selected",
                icon: <IconDownload size={15} />,
                loading: bulkExport.isPending,
                onClick: () => bulkExport.mutate(selectedProfiles),
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
        open={pending !== null}
        onClose={() => setPending(null)}
        title={pending !== null ? `Delete profile “${pending.name}”?` : "Delete profile"}
        description="Schedules built from it keep their settings but stop running until you pick a profile again."
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
        description="Schedules built from it keep their settings but stop running until you pick a profile again."
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
