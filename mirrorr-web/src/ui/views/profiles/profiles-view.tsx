import { useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
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
import type { Profile, ResolverSource } from "@/api/schemas"
import { humanize, showingLabel } from "@/ui/lib/format"
import { staggerContainer, staggerItem } from "@/ui/lib/motion"
import { AccessButton, useBulkAccessAction } from "@/ui/views/shared/resource-access-slot"
import {
  BulkBar,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  ErrorPanel,
  Fab,
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
  SelectionHead,
  PanelBody,
  SkeletonRows,
  Table,
  Tag,
  Td,
  Th,
  toast,
} from "@/ui/components"
import { useSelection } from "@/ui/hooks"
import { Page, Section } from "@/ui/views/shared/page"
import { SourcesPanel } from "./sources-panel"
import { PresetsDialog, type PresetKind } from "./presets-dialog"

/**
 * Profiles — the one resource here with create + update + delete (spec §5.8).
 * The view owns the page's single "+" and the one create/edit dialog for both
 * halves of the page (`presets-dialog.tsx`); each panel below it only lists,
 * filters and deletes its own rows.
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
          <AccessButton resourceType="profile" id={profile.id} label={profile.name} />
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
    <motion.article className="entity-card flex flex-col gap-3 p-4 border border-line rounded-md bg-surface-2" variants={staggerItem}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3" style={{ gap: "var(--s-2)", minWidth: 0 }}>
          <span className="flex items-center">
            <Checkbox
              aria-label={`Select ${profile.name}`}
              checked={selected}
              onChange={() => onToggle(profile.id)}
            />
          </span>
          <div className="text-md font-semibold text-ink [overflow-wrap:anywhere]" title={profile.name}>
            {profile.name}
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          <AccessButton resourceType="profile" id={profile.id} label={profile.name} />
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
      <dl className="flex flex-col gap-2">
        <div className="entity-card-fact flex flex-col gap-[2px] text-sm [&_dt]:text-ink-dim [&_dd]:text-ink [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere]">
          <dt>Resolver → Engine</dt>
          <dd>
            {resolveEntityName(profile.resolver_name, names.resolvers, profile.resolver_id)}
            <span className="text-dim" aria-hidden="true">
              {" → "}
            </span>
            {resolveEntityName(profile.engine_name, names.engines, profile.default_engine_id)}
          </dd>
        </div>
        <div className="entity-card-fact flex flex-col gap-[2px] text-sm [&_dt]:text-ink-dim [&_dd]:text-ink [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere]">
          <dt>Retry</dt>
          <dd>
            {profile.retry_mode !== undefined && profile.retry_mode !== "" ? (
              <Tag accent>{humanize(profile.retry_mode)}</Tag>
            ) : (
              <span className="text-dim">No retry</span>
            )}
          </dd>
        </div>
        <div className="entity-card-fact flex flex-col gap-[2px] text-sm [&_dt]:text-ink-dim [&_dd]:text-ink [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere]">
          <dt>Config</dt>
          <dd>
            <JsonView value={profile.resolver_config ?? {}} />
          </dd>
        </div>
      </dl>
    </motion.article>
  )
}

/** What the page's single "+" (or a section button) opened. */
interface PresetDialogTarget {
  readonly kind: PresetKind
  readonly allowKindSwitch: boolean
  readonly profile: Profile | null
  readonly source: ResolverSource | null
}

export function ProfilesView() {
  const [target, setTarget] = useState<PresetDialogTarget | null>(null)

  const create = (kind: PresetKind, allowKindSwitch: boolean): void =>
    setTarget({ kind, allowKindSwitch, profile: null, source: null })
  const editProfile = (profile: Profile): void =>
    setTarget({ kind: "profile", allowKindSwitch: false, profile, source: null })
  const editSource = (source: ResolverSource): void =>
    setTarget({ kind: "source", allowKindSwitch: false, profile: null, source })

  return (
    <Page title="Presets" description="Reusable profiles and saved resolver configs.">
      <ProfilesPanel onCreate={() => create("profile", false)} onEdit={editProfile} />
      <SourcesPanel onCreate={() => create("source", false)} onEdit={editSource} />

      {/* One "+" for the whole page, and the phone's only create entry (the Fab
          exists under `sm` only). It used to be one per panel, stacked in the
          same corner — the source one was painted last, so on touch layouts a
          profile could not be created at all. It is also the one entry where the
          kind still has to be asked for, so it carries the switcher. */}
      <Fab label="New preset" icon={<IconPlus size={22} />} onClick={() => create("profile", true)} />

      <PresetsDialog
        open={target !== null}
        kind={target?.kind ?? "profile"}
        allowKindSwitch={target?.allowKindSwitch ?? false}
        profile={target?.profile ?? null}
        source={target?.source ?? null}
        onClose={() => setTarget(null)}
      />
    </Page>
  )
}

const profileSearchFields = (profile: Profile): readonly string[] => [
  profile.name,
  profile.engine_name ?? "",
  profile.resolver_name ?? "",
  profile.retry_mode ?? "",
]

function ProfilesPanel({
  onCreate,
  onEdit,
}: {
  readonly onCreate: () => void
  readonly onEdit: (profile: Profile) => void
}) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")
  const [pending, setPending] = useState<Profile | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const selection = useSelection<number>()
  const names = useNameMaps()

  const list = useEntityList<Profile>({
    queryKey: queryKeys.profiles(),
    fetchPage: (cursor) => fetchProfilePage(cursor),
  })
  const { hasMore, isFetching, loadingAll, loadAll } = list

  const rows = useMemo(
    () => rankBySearch(list.items, search, profileSearchFields),
    [list.items, search],
  )

  const rowIds = useMemo(() => rows.map((profile) => profile.id), [rows])

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

  const selectedProfiles = list.items.filter((profile) => selection.has(profile.id))
  const access = useBulkAccessAction(
    "profile",
    selectedProfiles.map((profile) => ({ id: profile.id, label: profile.name })),
  )

  const columnCount = 6

  return (
    <Section
      title="Profiles"
      description="Reusable engine + resolver + retry presets. Start a session or autorun from one."
      actions={
        <Button variant="primary" className="max-sm:hidden" icon={<IconPlus size={16} />} onClick={onCreate}>
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
              <Button variant="primary" icon={<IconPlus size={16} />} onClick={onCreate}>
                New profile
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
                        onEdit={onEdit}
                        onDelete={setPending}
                        onExport={(target) => exportProfile.mutate(target)}
                      />
                    ))}
                  </tbody>
                </Table>
              </div>
              <motion.div className="cards-mobile hidden max-sm:flex max-sm:flex-col max-sm:gap-3 max-sm:p-3" variants={staggerContainer} initial="hidden" animate="visible">
                <SelectionHead
                  label="Select all profiles"
                  checked={selection.allSelected(rows.map((profile) => profile.id))}
                  onChange={(checked) =>
                    selection.setMany(checked ? rows.map((profile) => profile.id) : [])
                  }
                  count={rows.length}
                  noun="profile"
                />
                {rows.map((profile) => (
                  <ProfileCard
                    key={profile.id}
                    profile={profile}
                    names={names}
                    selected={selection.has(profile.id)}
                    onToggle={selection.toggle}
                    onEdit={onEdit}
                    onDelete={setPending}
                    onExport={(target) => exportProfile.mutate(target)}
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
        </>
      )}

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
