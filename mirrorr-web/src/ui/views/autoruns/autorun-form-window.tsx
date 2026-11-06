import { Field, Input } from "@/ui/components"
import { formatTimeZoneLabel } from "@/api/time"

/**
 * The start/end pair and its one note (`AUT-11`).
 *
 * "Your local time — stored as UTC" used to be printed twice, once under each
 * picker, and the note never named the zone it was talking about. This is the
 * pair's single helper: it names the viewer's zone, says the server keeps UTC,
 * and adds the derived length of the window. `datetime-local` keeps working in
 * local wall time — the conversion to naive UTC happens on save (`api/time.ts`).
 *
 * A live autorun's start can no longer be edited (`AUT-02`, `FLW-04`): the
 * server only accepts `end_time` while it runs, so an editable Start was a save
 * that reported success and dropped the edit. It is disabled, with the reason
 * in a line of its own.
 */

const WINDOW_NOTE_ID = "autorun-window-note"
const START_LOCK_ID = "autorun-start-lock"

/** "2 h", "45 min", "1 h 30 min" — the length of the window being picked. */
export function formatWindowLength(startLocal: string, endLocal: string): string | null {
  if (startLocal === "" || endLocal === "") return null
  const minutes = Math.round((new Date(endLocal).getTime() - new Date(startLocal).getTime()) / 60_000)
  if (!Number.isFinite(minutes) || minutes <= 0) return null
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest} min`
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

/** The pair's single helper line: whose clock, what is stored, how long it runs. */
export function windowNote(length: string | null, now: Date = new Date()): string {
  const zone = formatTimeZoneLabel(now)
  const base = `Times are in your local zone (${zone}); the server stores UTC.`
  return length === null ? base : `${base} ${length} long.`
}

export interface AutorunWindowFieldsProps {
  readonly startLocal: string
  readonly endLocal: string
  /** A live run keeps its start; editing it would be silently ignored. */
  readonly live: boolean
  readonly timeError: string | null
  readonly onStart: (value: string) => void
  readonly onEnd: (value: string) => void
}

export function AutorunWindowFields({
  startLocal,
  endLocal,
  live,
  timeError,
  onStart,
  onEnd,
}: AutorunWindowFieldsProps) {
  const length = formatWindowLength(startLocal, endLocal)
  const startDescribedBy = live ? `${WINDOW_NOTE_ID} ${START_LOCK_ID}` : WINDOW_NOTE_ID

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-5 max-sm:flex-col">
        <Field label="Start" htmlFor="autorun-start" required className="min-w-0 flex-1">
          <Input
            id="autorun-start"
            type="datetime-local"
            value={startLocal}
            disabled={live}
            aria-describedby={startDescribedBy}
            onChange={(event) => onStart(event.target.value)}
          />
        </Field>
        <Field
          label="End"
          htmlFor="autorun-end"
          required
          className="min-w-0 flex-1"
          error={timeError}
        >
          <Input
            id="autorun-end"
            type="datetime-local"
            value={endLocal}
            aria-describedby={WINDOW_NOTE_ID}
            onChange={(event) => onEnd(event.target.value)}
          />
        </Field>
      </div>
      {live ? (
        <p id={START_LOCK_ID} className="text-sm text-ink-dim">
          Start can’t move once running — the server only takes a new end time.
        </p>
      ) : null}
      <p id={WINDOW_NOTE_ID} className="text-sm text-ink-dim">
        {windowNote(length)}
      </p>
    </div>
  )
}
