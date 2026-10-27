import { Link } from "@tanstack/react-router"
import { formatBytes } from "@/api/time"
import { diskTone, liveReadout, nextRunReadout, storageReadout } from "@/api/domain/ops"
import { useOverview } from "@/api/hooks"
import { Panel, PanelBody, PanelHead, Stat } from "@/ui/components"

const TONE_CLASS = {
  normal: "",
  warning: "text-warning",
  danger: "text-danger",
} as const

/**
 * The sessions page's ops numbers, scoped to the reader by the server: what is
 * running now, what failed in the last day, how much disk is left, and when the
 * next schedule fires. It sits above the cards so a failure is visible without
 * scrolling a list that may not even contain the failing row.
 */
export function OpsStrip() {
  const overview = useOverview()
  const data = overview.data
  if (data === undefined) return null

  const live = liveReadout(data.sessions)
  const next = nextRunReadout(data.next_autorun)
  const failed = data.sessions.failed_24h
  const disk = data.disk ?? null

  return (
    <Panel data-testid="ops-strip">
      <PanelHead
        title="Now"
        actions={
          <span className="text-dim" style={{ fontSize: "var(--fs-sm)" }}>
            {data.sessions.total} session{data.sessions.total === 1 ? "" : "s"} in account
          </span>
        }
      />
      <PanelBody>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label="Live"
            value={
              <>
                {live.live}
                {live.notes.length === 0 ? null : (
                  <span className="text-dim"> · {live.notes.join(" · ")}</span>
                )}
              </>
            }
          />
          <Stat
            label="Failed in 24 h"
            value={<span className={failed > 0 ? TONE_CLASS.warning : undefined}>{failed}</span>}
          />
          <Stat
            label="Disk free"
            small
            value={
              disk === null ? (
                <span className="text-dim">—</span>
              ) : (
                <>
                  <span className={TONE_CLASS[diskTone(disk.free_bytes)]}>
                    {formatBytes(disk.free_bytes)}
                  </span>
                  <span className="block text-dim">{formatBytes(disk.total_bytes)} total</span>
                </>
              )
            }
          />
          <Stat
            label="Next schedule"
            small
            value={
              next === null ? (
                <span className="text-dim">none pending</span>
              ) : (
                <>
                  <Link
                    className="block truncate text-ink"
                    to="/autoruns/$autorunId"
                    params={{ autorunId: String(data.next_autorun?.id ?? "") }}
                    title={next.name}
                  >
                    {next.name}
                  </Link>
                  <span className="block text-dim">{next.countdown}</span>
                </>
              )
            }
          />
        </div>
      </PanelBody>
    </Panel>
  )
}

/** The recordings page's storage line: what the library costs on disk. */
export function StorageStrip() {
  const overview = useOverview()
  const data = overview.data
  if (data === undefined) return null
  const disk = data.disk ?? null

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-ink-muted"
      style={{ fontSize: "var(--fs-sm)" }}
      data-testid="storage-strip"
    >
      <span>{storageReadout(data.recordings)}</span>
      {disk === null ? null : (
        <span className={TONE_CLASS[diskTone(disk.free_bytes)]}>
          {formatBytes(disk.free_bytes)} free of {formatBytes(disk.total_bytes)}
        </span>
      )}
    </div>
  )
}
