import { useMemo } from "react"
import { useMutation } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  downloadJson,
  fetchAutorunExport,
  fetchAutorunPage,
  fetchProfileExport,
  fetchProfilePage,
  getErrorMessage,
  mergeBundles,
  useEntityList,
} from "@/api"
import type { Autorun, Profile } from "@/api/schemas"
import { queryKeys } from "@/api/query-keys"
import {
  Button,
  Checkbox,
  IconDownload,
  IconPlus,
  LoadMore,
  Panel,
  PanelBody,
  PanelFoot,
  PanelHead,
  QueryState,
  SkeletonRows,
  Table,
  Tag,
  Td,
  Th,
  toast,
} from "@/ui/components"
import { useScopedSelection } from "@/ui/hooks"
import { pluralize } from "@/ui/lib/format"
import { dedupeProfiles } from "./import-logic"

interface ExportRow {
  readonly key: string
  readonly kind: "profile" | "autorun"
  readonly id: number
  readonly name: string
  readonly detail: string
}

const EMPTY_STRIP =
  "flex flex-wrap items-center gap-2 px-3 py-2 rounded-md border border-line-subtle bg-surface-2 text-sm text-ink-muted"

function RowTable({
  caption,
  rows,
  selection,
}: {
  readonly caption: string
  readonly rows: readonly ExportRow[]
  readonly selection: ReturnType<typeof useScopedSelection<string>>
}) {
  return (
    <>
      <div className="hidden min-[672px]:block">
        <Table>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <Th className="cell-check" />
              <Th>Name</Th>
              <Th>Detail</Th>
              <Th>Type</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <Td>
                  <Checkbox
                    aria-label={`Export ${row.name}`}
                    checked={selection.has(row.key)}
                    onChange={() => selection.toggle(row.key)}
                  />
                </Td>
                <Td>{row.name}</Td>
                <Td className="text-ink-muted">{row.detail}</Td>
                <Td>
                  <Tag>{row.kind}</Tag>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>

      <ul className="flex flex-col gap-2 min-[672px]:hidden">
        {rows.map((row) => (
          <li
            key={row.key}
            className="flex items-start gap-2 rounded-md border border-line bg-surface-2 p-3"
          >
            <span className="flex h-6 items-center">
              <Checkbox
                aria-label={`Export ${row.name}`}
                checked={selection.has(row.key)}
                onChange={() => selection.toggle(row.key)}
              />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-md font-semibold text-ink [overflow-wrap:anywhere]">
                  {row.name}
                </span>
                <Tag>{row.kind}</Tag>
              </div>
              {row.detail === "" ? null : (
                <span className="text-sm text-ink-muted [overflow-wrap:anywhere]">
                  {row.detail}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

/**
 * Export is a picker over the items that actually exist — the previous version
 * exported one item at a time and claimed there were no profiles while the
 * Profiles page listed two. Each type states its own emptiness, so a missing
 * type never hides a populated one.
 */
export function ExportPanel() {
  const navigate = useNavigate()
  const profileList = useEntityList<Profile>({
    queryKey: queryKeys.profiles(),
    fetchPage: (cursor) => fetchProfilePage(cursor),
  })
  const autorunList = useEntityList<Autorun>({
    queryKey: queryKeys.autoruns(),
    fetchPage: (cursor) => fetchAutorunPage(cursor),
  })

  const profileRows: readonly ExportRow[] = useMemo(
    () =>
      profileList.items.map((profile) => ({
        key: `profile:${profile.id}`,
        kind: "profile" as const,
        id: profile.id,
        name: profile.name,
        detail: [profile.engine_name, profile.resolver_name].filter((part) => part != null && part !== "").join(" → "),
      })),
    [profileList.items],
  )
  const autorunRows: readonly ExportRow[] = useMemo(
    () =>
      autorunList.items.map((autorun) => ({
        key: `autorun:${autorun.id}`,
        kind: "autorun" as const,
        id: autorun.id,
        name: autorun.user_friendly_name,
        detail: autorun.profile_name ?? "",
      })),
    [autorunList.items],
  )

  const visibleIds = useMemo(
    () => [...profileRows, ...autorunRows].map((row) => row.key),
    [profileRows, autorunRows],
  )
  const selection = useScopedSelection<string>(visibleIds)
  const targets = [...profileRows, ...autorunRows].filter((row) => selection.has(row.key))

  const exportSelected = useMutation({
    mutationFn: async (rows: readonly ExportRow[]) => {
      const bundles = await Promise.all(
        rows.map((row) =>
          row.kind === "profile" ? fetchProfileExport(row.id) : fetchAutorunExport(row.id),
        ),
      )
      return dedupeProfiles(mergeBundles(bundles))
    },
    onSuccess: (bundle, rows) => {
      if (!downloadJson(`mirrorr-export-${rows.length}.json`, bundle)) {
        toast.error("Export failed", "The download could not be started.")
        return
      }
      toast.success("Exported", `${pluralize(rows.length, "item")} in one bundle.`)
      selection.clear()
    },
    onError: (error) => toast.error("Export failed", getErrorMessage(error, "Export failed")),
  })

  const emptyProfiles = profileList.isLoading === false && profileList.isError === false && profileRows.length === 0
  const emptyAutoruns = autorunList.isLoading === false && autorunList.isError === false && autorunRows.length === 0

  return (
    <Panel>
      <PanelHead title="Export" />
      <PanelBody>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Checkbox
              label="Select all"
              checked={visibleIds.length > 0 && selection.allSelected(visibleIds)}
              indeterminate={!selection.allSelected(visibleIds) && selection.count > 0}
              onChange={(event) => selection.setMany(event.target.checked ? visibleIds : [])}
            />
            <span className="text-sm text-dim tabular-nums">
              {`${selection.count} of ${visibleIds.length} selected`}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-ink-muted">
              {`Profiles (${profileRows.length})`}
            </h3>
            <QueryState
              query={profileList}
              loading={<SkeletonRows rows={3} cols={4} />}
              isEmpty={emptyProfiles}
              empty={
                <div className={EMPTY_STRIP}>
                  <span>No profiles yet — nothing of this type to export.</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<IconPlus size={14} />}
                    onClick={() => void navigate({ to: "/profiles" })}
                  >
                    Create a profile
                  </Button>
                </div>
              }
              errorMessage="Could not load profiles"
            >
              <RowTable caption="Profiles available to export" rows={profileRows} selection={selection} />
              <LoadMore
                hasMore={profileList.hasMore}
                isFetching={profileList.isFetching}
                onLoadMore={profileList.loadMore}
                count={profileList.totalCount}
              />
            </QueryState>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-ink-muted">
              {`Autoruns (${autorunRows.length})`}
            </h3>
            <QueryState
              query={autorunList}
              loading={<SkeletonRows rows={3} cols={4} />}
              isEmpty={emptyAutoruns}
              empty={
                <div className={EMPTY_STRIP}>
                  <span>No autoruns yet — nothing of this type to export.</span>
                </div>
              }
              errorMessage="Could not load autoruns"
            >
              <RowTable caption="Autoruns available to export" rows={autorunRows} selection={selection} />
              <LoadMore
                hasMore={autorunList.hasMore}
                isFetching={autorunList.isFetching}
                onLoadMore={autorunList.loadMore}
                count={autorunList.totalCount}
              />
            </QueryState>
          </div>
        </div>
      </PanelBody>
      <PanelFoot>
        <div className="flex w-full flex-wrap items-center justify-end gap-3">
          {selection.count === 0 ? (
            <span className="mr-auto text-sm text-dim">
              Select at least one profile or autorun to export.
            </span>
          ) : null}
          <Button
            variant="primary"
            icon={<IconDownload size={15} />}
            loading={exportSelected.isPending}
            disabled={targets.length === 0}
            onClick={() => exportSelected.mutate(targets)}
          >
            Export selected
          </Button>
        </div>
      </PanelFoot>
    </Panel>
  )
}
