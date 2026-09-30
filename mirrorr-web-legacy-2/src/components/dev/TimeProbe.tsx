/**
 * TEMPORARY scaffolding for the time-module step (removed in Wave 2 with the
 * other probes). Renders pinned fixtures through the real formatters so the
 * Playwright spec can assert — in a real browser with a pinned timezoneId —
 * the once-per-view zone label, the relative time's absolute `title`, and the
 * m:ss / h:mm:ss boundary. Every class comes from `src/styles.css`; no literal
 * colour lives here.
 */
import {
  formatBytes,
  formatCountdown,
  formatDateTime,
  formatDuration,
  formatRelativeTime,
  localZoneLabel,
} from "@/lib/format"
import { datetimeLocalToNaiveUtc } from "@/lib/time"

/** A fixed instant so the browser spec never races the wall clock. */
const FIXTURE_NOW = new Date(Date.UTC(2026, 6, 15, 12, 0, 0))
const FIXTURE_RELATIVE = "2026-07-15T11:58:00"
const FIXTURE_COUNTDOWN_START = "2026-07-15T15:12:00"
const FIXTURE_WALL_INPUT = "2026-07-15T08:00"

export function TimeProbe() {
  const relative = formatRelativeTime(FIXTURE_RELATIVE, FIXTURE_NOW)

  return (
    <section
      data-testid="time-probe"
      aria-label="Time module probe"
      className="flex w-full max-w-3xl flex-col gap-3"
    >
      <header className="flex flex-col gap-1">
        <h1 className="text-title font-semibold text-text-primary">Time probe</h1>
        <p className="text-small text-text-secondary">
          Temporary scaffold: naive-UTC parsing, local display, countdowns, durations and sizes.
          Zone{" "}
          <span data-testid="tz-label" className="text-text-primary">
            {localZoneLabel(FIXTURE_NOW)}
          </span>
        </p>
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-small">
        <Row testId="absolute-time" label="Absolute local display" value={formatDateTime("2026-07-15T12:00:00")} />
        <Row testId="relative-time" label="Relative time" value={relative.text} title={relative.title} />
        <Row
          testId="countdown"
          label="Countdown"
          value={formatCountdown(FIXTURE_COUNTDOWN_START, FIXTURE_NOW) ?? "—"}
        />
        <Row testId="duration-short" label="Duration under 1 h" value={formatDuration(3599)} />
        <Row testId="duration-long" label="Duration from 1 h" value={formatDuration(3600)} />
        <Row testId="size-bytes" label="Size" value={formatBytes(842.3 * 1024 * 1024)} />
        <Row
          testId="naive-utc-write"
          label="Wall time to naive UTC"
          value={datetimeLocalToNaiveUtc(FIXTURE_WALL_INPUT)}
        />
      </dl>
    </section>
  )
}

interface RowProps {
  readonly testId: string
  readonly label: string
  readonly value: string
  readonly title?: string
}

function Row({ testId, label, value, title }: RowProps) {
  return (
    <>
      <dt className="text-text-muted">{label}</dt>
      <dd data-testid={testId} title={title} className="font-mono text-text-primary">
        {value}
      </dd>
    </>
  )
}
