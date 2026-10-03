import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/Button"
import { Chip } from "@/components/ui/Chip"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { EmptyState } from "@/components/ui/EmptyState"
import { ErrorPanel } from "@/components/ui/ErrorPanel"
import { Fab } from "@/components/ui/Fab"
import { OverflowMenu, type OverflowMenuItem } from "@/components/ui/OverflowMenu"
import { StatusChip } from "@/components/ui/StatusChip"
import { Table, TableBody, TableCell, TableHead, TableRow } from "@/components/ui/Table"
import { IconPlus } from "@/components/ui/icons"
import { queryKeys, resolveEntityName } from "@/lib/query-keys"
import type { Autorun } from "@/lib/schemas"
import { getStatusDescriptor } from "@/lib/status-map"
import { COUNTDOWN_TICK_MS, formatCountdown, formatDateTime } from "@/lib/time"
import { fetchAutorunPage } from "@/views/shared/api"
import { useEntityList, useEngines, useIsCompact, useNameMaps, useNowTick } from "@/views/shared/hooks"
import { EngineResolverPair, RecordingCell, SaveAsProfileDialog, statusChipProps } from "@/views/shared/parts"
import { AutorunWizardDialog } from "./autorun-wizard-dialog"
import { useAutorunCommands } from "./autorun-shared"
import { isSpent, matchesFilter, shouldAutoExhaust, type FilterToken } from "./filter-grammar"
import "@/styles/views-entities.css"

type Mode = "upcoming" | "spent" | "all"

function modeFromLocation(): Mode {
  if (typeof window === "undefined") return "upcoming"
  const raw = new URLSearchParams(window.location.search).get("filter")
  return raw === "spent" || raw === "all" ? raw : "upcoming"
}

function setModeInLocation(mode: Mode): void {
  if (typeof window === "undefined") return
  const url = new URL(window.location.href)
  url.searchParams.set("filter", mode)
  window.history.replaceState({}, "", url.toString())
}

function tokensFor(mode: Mode): FilterToken[] {
  if (mode === "all") return ["all"]
  if (mode === "spent") return ["scheduled", "live", "spent"]
  return ["scheduled", "live"]
}

const MODES: ReadonlyArray<{ readonly value: Mode; readonly label: string }> = [
  { value: "upcoming", label: "Upcoming" },
  { value: "spent", label: "Include spent" },
  { value: "all", label: "All" },
]

/**
 * §5.5 — Scheduled recordings (autoruns). ONE-SHOT framing throughout: a
 * scheduled recording fires once at its start time and then retires (never
 * re-arms). Spent rows are hidden by default and always dimmed when shown.
 */
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

  const [mode, setMode] = useState<Mode>(modeFromLocation)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [editing, setEditing] = useState<Autorun | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Autorun | null>(null)
  const [saveTarget, setSaveTarget] = useState<Autorun | null>(null)
  const [loadedAll, setLoadedAll] = useState(false)

  const tokens = useMemo(() => tokensFor(mode), [mode])
  const filtered = useMemo(
    () => list.items.filter((autorun) => matchesFilter(autorun.status, tokens)),
    [list.items, tokens],
  )

  useEffect(() => {
    if (!shouldAutoExhaust(tokens) || !list.hasMore || loadedAll) return
    void list.loadAll().then(() => setLoadedAll(true))
  }, [tokens, list, loadedAll])

  const canRecordFor = (autorun: Autorun): boolean =>
    engines.find((entry) => entry.id === autorun.engine_id)?.capabilities?.can_record !== false

  const openCreate = () => {
    setEditing(null)
    setWizardOpen(true)
  }

  return (
    <div className="ve">
      <div className="ve-bar">
        <div className="ve-filters" role="group" aria-label="Filter scheduled recordings">
          {MODES.map((entry) => (
            <Chip
              key={entry.value}
              selected={mode === entry.value}
              onClick={() => {
                setModeInLocation(entry.value)
                setMode(entry.value)
                setLoadedAll(false)
              }}
            >
              {entry.label}
            </Chip>
          ))}
        </div>
        <div className="ve-bar__end">
          <Button variant="primary" onClick={openCreate}>
            New scheduled recording
          </Button>
        </div>
      </div>

      <p className="ve-note">
        A scheduled recording runs once at its start time and then retires — create a new one to repeat.
      </p>

      {list.isLoading ? (
        <div className="opaque ve-table-panel">
          <Table label="Scheduled recordings">
            <TableHead>
              <TableRow>
                <TableCell>Status</TableCell>
                <TableCell>Name</TableCell>
                <TableCell>Window</TableCell>
                <TableCell>Countdown</TableCell>
                <TableCell>Engine → Resolver</TableCell>
                <TableCell>Recording</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody loading columns={7} />
          </Table>
        </div>
      ) : list.isError ? (
        <ErrorPanel
          title="Could not load scheduled recordings"
          body={list.error instanceof Error ? list.error.message : "Unexpected server response."}
          actions={
            <Button variant="secondary" onClick={list.refetch}>
              Retry
            </Button>
          }
        />
      ) : list.items.length === 0 ? (
        <div className="opaque ve-panel">
          <EmptyState
            eyebrow="Scheduled recordings"
            headline="No scheduled recordings."
            body="A scheduled recording runs once at its start time and then retires."
            action={
              <Button variant="primary" onClick={openCreate}>
                New scheduled recording
              </Button>
            }
          />
        </div>
      ) : filtered.length === 0 ? (
        <div className="opaque ve-panel">
          <EmptyState
            eyebrow="Filter"
            headline={mode === "upcoming" ? "Nothing upcoming." : "No spent recordings."}
            body="No scheduled recording matches this filter."
            action={
              <Button variant="secondary" onClick={() => setMode("all")}>
                Show all
              </Button>
            }
          />
        </div>
      ) : (
        <div className="opaque panel ve-table-panel">
          <Table label="Scheduled recordings" className="ve-table">
            <TableHead>
              <TableRow>
                <TableCell className="ve-c-status">Status</TableCell>
                <TableCell className="ve-c-name">Name</TableCell>
                <TableCell className="ve-c-window">Window</TableCell>
                <TableCell className="ve-c-countdown">Countdown</TableCell>
                <TableCell className="ve-c-pair">Engine → Resolver</TableCell>
                <TableCell className="ve-c-recording">Recording</TableCell>
                <TableCell className="ve-c-actions">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody columns={7}>
              {filtered.map((autorun) => {
                const chip = statusChipProps(autorun.status)
                const spent = isSpent(autorun.status)
                const engineName = resolveEntityName(autorun.engine_name, names.engines, autorun.engine_id)
                const resolverName = resolveEntityName(autorun.resolver_name, names.resolvers, autorun.resolver_id)
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
                  <TableRow key={autorun.id} className={spent ? "ve-row--spent" : undefined}>
                    <TableCell className="ve-c-status">
                      <StatusChip status={chip.status} title={spent ? "Spent" : chip.title} compact />
                    </TableCell>
                    <TableCell className="ve-c-name">
                      <span className="ve-title-cell">
                        <span className="ve-title-cell__name">{autorun.user_friendly_name}</span>
                        <span className="ve-title-cell__meta">{autorun.snake_case_name}</span>
                      </span>
                    </TableCell>
                    <TableCell className="ve-c-window">
                      <span className="ve-window">
                        <span className="ve-dim">
                          {formatDateTime(autorun.start_time)}
                          {" → "}
                          {formatDateTime(autorun.end_time)}
                        </span>
                        <span className="ve-window__tz">stored UTC · your local time</span>
                      </span>
                    </TableCell>
                    <TableCell className="ve-c-countdown">
                      <span className="ve-countdown">
                        {spent ? "spent" : formatCountdown(autorun.start_time, now)}
                      </span>
                    </TableCell>
                    <TableCell className="ve-c-pair">
                      <EngineResolverPair
                        engineName={engineName}
                        resolverName={resolverName}
                        tag={
                          autorun.profile_id == null
                            ? undefined
                            : {
                                label: resolveEntityName(autorun.profile_name, names.profiles, autorun.profile_id),
                                href: `/profiles?highlight=${autorun.profile_id}`,
                              }
                        }
                      />
                    </TableCell>
                    <TableCell className="ve-c-recording">
                      <RecordingCell recording={autorun.recording} canRecord={canRecordFor(autorun)} />
                    </TableCell>
                    <TableCell className="ve-c-actions">
                      <span className="ve-inline">
                        {promoted === "run" ? (
                          <Button variant="secondary" onClick={() => void commands.runNow(autorun)}>
                            Run now
                          </Button>
                        ) : promoted === "edit" ? (
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setEditing(autorun)
                              setWizardOpen(true)
                            }}
                          >
                            Edit
                          </Button>
                        ) : promoted === "save" ? (
                          <Button variant="secondary" onClick={() => setSaveTarget(autorun)}>
                            Save as profile
                          </Button>
                        ) : null}
                        {menuItems.length > 0 ? (
                          <OverflowMenu
                            items={menuItems}
                            triggerLabel={`Actions for ${autorun.user_friendly_name}`}
                          />
                        ) : null}
                      </span>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {list.items.length > 0 ? (
        <div className="ve-bar">
          <span className="ve-note">{`Showing ${filtered.length}${list.hasMore ? "+" : ""}`}</span>
          <div className="ve-bar__end">
            {list.hasMore && mode === "all" ? (
              <Button variant="secondary" loading={list.isFetching} onClick={list.loadMore}>
                Load more
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {compact ? (
        <Fab aria-label="New scheduled recording" icon={<IconPlus size={24} />} onClick={openCreate} />
      ) : null}

      <AutorunWizardDialog
        key={`autorun-wizard-${wizardOpen ? "open" : "closed"}-${editing?.id ?? "new"}`}
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
        title={`Delete scheduled recording '${deleteTarget?.user_friendly_name ?? ""}'?`}
        body={
          deleteTarget !== null && !isSpent(deleteTarget.status) ? (
            <>
              <p>It will also stop and delete any running recording it started.</p>
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
    </div>
  )
}
