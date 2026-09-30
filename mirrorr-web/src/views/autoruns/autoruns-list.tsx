import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/Button"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { EmptyState } from "@/components/ui/EmptyState"
import { ErrorPanel } from "@/components/ui/ErrorPanel"
import { Fab } from "@/components/ui/Fab"
import { OverflowMenu, type OverflowMenuItem } from "@/components/ui/OverflowMenu"
import { SkeletonList } from "@/components/ui/Skeleton"
import { StatusChip } from "@/components/ui/StatusChip"
import { IconPlus } from "@/components/ui/icons"
import { queryKeys, resolveEntityName } from "@/lib/query-keys"
import type { Autorun } from "@/lib/schemas"
import { getStatusDescriptor } from "@/lib/status-map"
import { COUNTDOWN_TICK_MS, formatCountdown, formatDateTime, formatRelativeTime } from "@/lib/time"
import { fetchAutorunPage } from "@/views/shared/api"
import {
  useEntityList,
  useEngines,
  useIsCompact,
  useNameMaps,
  useNowTick,
} from "@/views/shared/hooks"
import { EngineResolverPair, RecordingCell, RouteLink, SaveAsProfileDialog, statusChipProps } from "@/views/shared/parts"
import { AutorunWizardDialog } from "./autorun-wizard-dialog"
import { useAutorunCommands } from "./autorun-shared"
import { isSpent, matchesFilter, parseFilter, shouldAutoExhaust, type FilterToken } from "./filter-grammar"

const FILTER_CHIPS: ReadonlyArray<{ token: FilterToken; label: string }> = [
  { token: "scheduled", label: "Scheduled" },
  { token: "live", label: "Live" },
  { token: "spent", label: "Spent" },
  { token: "all", label: "All" },
]

function filterFromLocation(): string | null {
  if (typeof window === "undefined") return null
  return new URLSearchParams(window.location.search).get("filter")
}

function setFilterInLocation(next: string): void {
  const url = new URL(window.location.href)
  url.searchParams.set("filter", next)
  window.history.replaceState({}, "", url.toString())
}

/** V5 — Autoruns list (`/autoruns?filter=scheduled|live|spent|all`). */
export function AutorunsList() {
  const names = useNameMaps()
  const engines = useEngines()
  const commands = useAutorunCommands()
  const compact = useIsCompact()
  
  const now = useNowTick(COUNTDOWN_TICK_MS)

  const list = useEntityList<Autorun>({
    queryKey: queryKeys.autoruns({}),
    fetchPage: (cursor) => fetchAutorunPage(cursor),
  })

  const [filterParam, setFilterParam] = useState(filterFromLocation)
  const tokens = useMemo(() => parseFilter(filterParam), [filterParam])
  const [wizardOpen, setWizardOpen] = useState(false)
  const [editing, setEditing] = useState<Autorun | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Autorun | null>(null)
  const [saveTarget, setSaveTarget] = useState<Autorun | null>(null)
  const [loadedAll, setLoadedAll] = useState(false)

  const filtered = useMemo(
    () => list.items.filter((autorun) => matchesFilter(autorun.status, tokens)),
    [list.items, tokens],
  )

  useEffect(() => {
    if (!shouldAutoExhaust(tokens) || !list.hasMore || loadedAll) return
    void list.loadAll().then(() => setLoadedAll(true))
  }, [tokens, list, loadedAll])

  const canRecordFor = (autorun: Autorun): boolean => {
    const engine = engines.find((entry) => entry.id === autorun.engine_id)
    return engine?.capabilities?.can_record !== false
  }

  const body = (() => {
    if (list.isLoading) return <SkeletonList rows={5} />
    if (list.isError) {
      return (
        <ErrorPanel
          title="Request failed"
          body={list.error instanceof Error ? list.error.message : "Unexpected server response"}
          actions={
            <Button variant="ghost" onClick={list.refetch}>
              Retry
            </Button>
          }
        />
      )
    }
    if (list.items.length === 0) {
      return (
        <EmptyState
          headline="Nothing here yet"
          body="No autoruns — schedule a recording"
          action={
            <Button
              variant="primary"
              onClick={() => {
                setEditing(null)
                setWizardOpen(true)
              }}
            >
              New autorun
            </Button>
          }
        />
      )
    }
    return (
      <table className="entity-table">
        <thead>
          <tr>
            <th scope="col">Status</th>
            <th scope="col">Name</th>
            <th scope="col">Engine → Resolver</th>
            <th scope="col">Start</th>
            <th scope="col">End</th>
            <th scope="col">Recording</th>
            <th scope="col">Countdown</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((autorun) => {
            const chip = statusChipProps(autorun.status)
            const spent = isSpent(autorun.status)
            const engineName = resolveEntityName(autorun.engine_name, names.engines, autorun.engine_id)
            const resolverName = resolveEntityName(autorun.resolver_name, names.resolvers, autorun.resolver_id)
            const countdown = spent ? "spent" : formatCountdown(autorun.start_time, now)
            const actions = getStatusDescriptor(autorun.status).autorunActions
            const hasEdit = actions.includes("edit")
            const hasRun = actions.includes("run-now")
            const hasSave = actions.includes("save-as-profile")
            const hasDelete = actions.includes("delete")
            const promoted = hasRun ? "run" : hasEdit ? "edit" : hasSave ? "save" : null
            const menuItems: OverflowMenuItem[] = []
            if (hasEdit && promoted !== "edit") {
              menuItems.push({
                id: "edit",
                label: "Edit",
                onSelect: () => {
                  setEditing(autorun)
                  setWizardOpen(true)
                },
              })
            }
            if (hasRun && promoted !== "run") {
              menuItems.push({ id: "run", label: "Run now", onSelect: () => void commands.runNow(autorun) })
            }
            if (hasSave && promoted !== "save") {
              menuItems.push({ id: "save", label: "Save as profile", onSelect: () => setSaveTarget(autorun) })
            }
            if (hasDelete) {
              menuItems.push({ id: "delete", label: "Delete", destructive: true, onSelect: () => setDeleteTarget(autorun) })
            }
            return (
              <tr key={autorun.id} className="entity-row" data-spent={spent ? "true" : undefined}>
                <td data-col="status">
                  <StatusChip status={chip.status} title={spent ? "spent" : chip.title} compact />
                </td>
                <td data-col="name">
                  <span className="t-body-strong">{autorun.user_friendly_name}</span>
                  <br />
                  <span className="t-mono-inline">{autorun.snake_case_name}</span>
                </td>
                <td data-col="enginepair">
                  <EngineResolverPair engineName={engineName} resolverName={resolverName} />
                </td>
                <td data-col="start">
                  <span className="t-meta" title={formatDateTime(autorun.start_time)}>
                    {formatRelativeTime(autorun.start_time)}
                  </span>
                </td>
                <td data-col="end">
                  <span className="t-meta" title={formatDateTime(autorun.end_time)}>
                    {formatRelativeTime(autorun.end_time)}
                  </span>
                </td>
                <td data-col="recording">
                  <RecordingCell recording={autorun.recording} canRecord={canRecordFor(autorun)} />
                </td>
                <td data-col="countdown">
                  <span className="t-meta num">{countdown}</span>
                </td>
                <td data-col="actions">
                  <span className="cluster">
                    {promoted === "run" ? (
                      <Button
                        variant="ghost"
                        className="row-primary-action"
                        onClick={() => void commands.runNow(autorun)}
                      >
                        Run now
                      </Button>
                    ) : promoted === "edit" ? (
                      <Button
                        variant="ghost"
                        className="row-primary-action"
                        onClick={() => {
                          setEditing(autorun)
                          setWizardOpen(true)
                        }}
                      >
                        Edit
                      </Button>
                    ) : promoted === "save" ? (
                      <Button
                        variant="ghost"
                        className="row-primary-action"
                        onClick={() => setSaveTarget(autorun)}
                      >
                        Save as profile
                      </Button>
                    ) : null}
                    {menuItems.length > 0 ? (
                      <OverflowMenu items={menuItems} triggerLabel={`Actions for ${autorun.user_friendly_name}`} />
                    ) : null}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    )
  })()

  return (
    <div className="view">
      <div className="view-header">
        <div className="list-toolbar">
          <div className="filter-chips" role="group" aria-label="Filter autoruns">
            {FILTER_CHIPS.map((chip) => (
              <button
                key={chip.token}
                type="button"
                className="chip-btn"
                data-active={tokens.includes(chip.token)}
                onClick={() => {
                  setFilterInLocation(chip.token)
                  setFilterParam(chip.token)
                  setLoadedAll(false)
                }}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>
        <div className="view-header__actions">
          <Button
            variant="primary"
            onClick={() => {
              setEditing(null)
              setWizardOpen(true)
            }}
          >
            New autorun
          </Button>
        </div>
      </div>

      {body}

      {filtered.length > 0 ? (
        <div className="list-footer">
          <span className="num">{`Showing ${filtered.length}`}</span>
          {list.hasMore && !shouldAutoExhaust(tokens) ? (
            <Button variant="ghost" loading={list.isFetching} onClick={list.loadMore}>
              Load more
            </Button>
          ) : null}
        </div>
      ) : null}

      {compact ? (
        <Fab
          aria-label="New autorun"
          icon={<IconPlus size={24} />}
          onClick={() => {
            setEditing(null)
            setWizardOpen(true)
          }}
        />
      ) : null}

      <AutorunWizardDialog
        key={`${wizardOpen ? "open" : "closed"}-${editing?.id ?? "new"}`}
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        editing={editing}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          const target = deleteTarget
          setDeleteTarget(null)
          if (target !== null) void commands.remove(target)
        }}
        title={`Delete autorun '${deleteTarget?.user_friendly_name ?? ""}'?`}
        body={
          deleteTarget !== null && !isSpent(deleteTarget.status) ? (
            <>
              <p>A recording is running — deleting will stop and delete it.</p>
              <p>This cannot be undone.</p>
            </>
          ) : (
            <p>This cannot be undone.</p>
          )
        }
        tone="destructive"
        confirmLabel="Delete"
      />

      <SaveAsProfileDialog
        open={saveTarget !== null}
        onClose={() => setSaveTarget(null)}
        onSave={async (profileName) => {
          const target = saveTarget
          setSaveTarget(null)
          if (target !== null) await commands.saveAsProfile(target, profileName)
        }}
      />

      {list.items.length > 0 ? (
        <p className="view-footnote">
          Countdowns tick every 10s.{" "}
          <RouteLink to="/autoruns" search={{ filter: "all" }} className="t-body">
            Show all
          </RouteLink>
        </p>
      ) : null}
    </div>
  )
}
