import type { ReactNode } from "react"
import type { AutorunIssue } from "@/api/domain/autorun-issue"
import { IconAlert, IconInfo } from "@/ui/components"
import { cn } from "@/ui/lib/cn"

/**
 * The detail page's warning surface. Three banners used to stack above the
 * facts — one per condition — and two of them restated a line the chip or the
 * schedule already carried. They are one ordered list now: a blocking problem
 * first, then a window that has already opened, then a note about the run in
 * progress. The order is fixed, so the list never re-ranks itself between
 * states, and no item may repeat the status chip's word.
 */

export type AutorunNoticeTone = "warning" | "info"

export interface AutorunNotice {
  readonly key: string
  readonly tone: AutorunNoticeTone
  readonly title: string
  readonly detail: string
}

export interface AutorunNoticeInput {
  /** The record's own blocking reason, already worded by `autorunIssue()`. */
  readonly issue: AutorunIssue | null
  /** A `scheduled` autorun whose start time is already behind us. */
  readonly startPassed: boolean
  /** The run it spawned is still up (`deriveRunState().panels.live`). */
  readonly live: boolean
}

const START_PASSED: Omit<AutorunNotice, "key"> = {
  tone: "warning",
  title: "Its start time has already passed",
  detail: "The server starts it as soon as it can. Edit the schedule if that is not what you want.",
}

const LIVE_RUN: Omit<AutorunNotice, "key"> = {
  tone: "info",
  title: "Its run is live now",
  detail: "Editing this autorun will not change the run already in progress.",
}

/** Conditions → one ordered list. Empty means the record needs no preface. */
export function autorunNotices({ issue, startPassed, live }: AutorunNoticeInput): readonly AutorunNotice[] {
  const items: AutorunNotice[] = []
  if (issue !== null) {
    items.push({ key: `issue:${issue.code}`, tone: "warning", title: issue.title, detail: issue.detail })
  }
  if (startPassed) items.push({ key: "start-passed", ...START_PASSED })
  if (live) items.push({ key: "live-run", ...LIVE_RUN })
  return items
}

const TONE_ICON: Record<AutorunNoticeTone, ReactNode> = {
  warning: <IconAlert size={16} />,
  info: <IconInfo size={16} />,
}

const TONE_COLOR: Record<AutorunNoticeTone, string> = {
  warning: "text-warning",
  info: "text-info",
}

export function AutorunNotices({ items }: { readonly items: readonly AutorunNotice[] }) {
  if (items.length === 0) return null
  return (
    <section
      aria-label="Before you run it"
      data-slot="autorun-notices"
      className="rounded-md border border-line bg-surface-2"
    >
      <ol className="flex flex-col divide-y divide-line-subtle">
        {items.map((item) => (
          <li key={item.key} className="flex items-start gap-3 px-4 py-3">
            <span className={cn("mt-0.5 shrink-0", TONE_COLOR[item.tone])} aria-hidden="true">
              {TONE_ICON[item.tone]}
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-ink">{item.title}</p>
              <p className="text-sm text-ink-muted">{item.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
