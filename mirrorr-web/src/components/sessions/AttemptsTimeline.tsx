/**
 * V4 — the attempts timeline.
 *
 * Contract: `docs/web-frontend-spec.md` L267-L277 — one row per attempt with
 * index, status, started → ended, exit code / reason when the attempt failed,
 * and the session's `retry_attempts` counter. Rows are keyed by `index` (the
 * server may repeat index 1 across sessions, never within one).
 */
import type { SessionAttempt } from "@/lib/schemas/sessions"
import { formatDateTime } from "@/lib/format"

export interface AttemptsTimelineProps {
  attempts: readonly SessionAttempt[] | null | undefined
  retryAttempts: number | null | undefined
}

type AttemptStatus = "ok" | "failed" | "running"

const STATUS_LABEL: Readonly<Record<AttemptStatus, string>> = {
  ok: "ok",
  failed: "failed",
  running: "running",
}

const STATUS_CLASS: Readonly<Record<AttemptStatus, string>> = {
  ok: "text-ok",
  failed: "text-danger",
  running: "text-text-secondary",
}

function statusFor(returncode: number | null | undefined): AttemptStatus {
  if (returncode === null || returncode === undefined) return "running"
  return returncode === 0 ? "ok" : "failed"
}

function safeDateTime(value: string | null | undefined): string {
  if (typeof value !== "string" || value.length === 0) return "—"
  try {
    return formatDateTime(value)
  } catch {
    return "—"
  }
}

export function AttemptsTimeline({ attempts, retryAttempts }: AttemptsTimelineProps) {
  const rows = attempts ?? []
  const retries = typeof retryAttempts === "number" && retryAttempts > 0 ? retryAttempts : null

  return (
    <section
      data-testid="attempts-timeline"
      className="rounded-surface border border-border bg-bg-raised p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-label font-medium text-text-secondary">Attempts</h2>
        {retries !== null ? (
          <span data-testid="attempts-retry-count" className="text-small text-text-muted">
            retry {retries}
          </span>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p data-testid="attempts-empty" className="mt-2 text-small text-text-muted">
          No attempts yet.
        </p>
      ) : (
        <ol className="mt-3 flex flex-col gap-2">
          {rows.map((attempt, position) => {
            const status = statusFor(attempt.returncode)
            const failed = status === "failed"
            return (
              <li
                key={attempt.index ?? position}
                data-testid="attempt-row"
                data-status={status}
                className="rounded-control border border-border bg-bg-inset px-3 py-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-small text-text-secondary">
                    #{attempt.index ?? position + 1}
                  </span>
                  <span className={`text-small font-medium ${STATUS_CLASS[status]}`}>
                    {STATUS_LABEL[status]}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-text-muted">
                  <span data-testid="attempt-times">
                    {safeDateTime(attempt.started_at)} → {safeDateTime(attempt.ended_at)}
                  </span>
                  <span data-testid="attempt-exit">exit {attempt.returncode ?? "—"}</span>
                </div>
                {failed && typeof attempt.reason === "string" && attempt.reason.length > 0 ? (
                  <p data-testid="attempt-reason" className="mt-1 text-small text-danger">
                    {attempt.reason}
                  </p>
                ) : null}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
