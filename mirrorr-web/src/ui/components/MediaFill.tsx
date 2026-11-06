import type { ReactNode } from "react"
import { cn } from "@/ui/lib/cn"

/**
 * The closed set of media fills. A surface may not invent a new one: a state
 * with nothing to play maps to a **plate** built from the record, never to a
 * black box or a broken image.
 *
 * - `frame` — a live preview (the player owns the box)
 * - `cover` — the published file's own first frame, via a muted
 *   `preload="metadata"` `<video>` seeked just past zero. No ffmpeg pass, no
 *   thumbnail route, no cache to invalidate.
 * - `plate` — no file to show; carries real fields from the record.
 *
 * `pin` is the remux progress line: it sits on the bottom edge of whichever
 * fill is showing, so finalising adds no height to the card.
 */
export type MediaFillProps =
  | {
      readonly fill: "frame"
      /** The player element — it supplies its own 16:9 box. */
      readonly children: ReactNode
      readonly label: string
      readonly pin?: ReactNode
      readonly className?: string
    }
  | {
      readonly fill: "cover"
      readonly src: string
      readonly label: string
      /** Optional poster for the instant before metadata paints. */
      readonly poster?: string
      readonly pin?: ReactNode
      readonly className?: string
    }
  | {
      readonly fill: "plate"
      /** At least three values from the record; the first is the headline. */
      readonly fields: readonly ReactNode[]
      readonly label: string
      readonly tone?: "neutral" | "warning" | "danger" | "success"
      readonly pin?: ReactNode
      readonly className?: string
    }

/** Seek past zero so the browser paints a frame rather than a black first keyframe. */
export function firstFrameUrl(src: string): string {
  return src.includes("#") ? src : `${src}#t=0.1`
}

const PLATE_TONE = {
  neutral: "border-line bg-surface-3",
  warning: "border-[color:rgba(227,179,65,0.35)] bg-warning-dim",
  danger: "border-[color:rgba(248,81,73,0.35)] bg-danger-dim",
  success: "border-[color:rgba(63,185,80,0.35)] bg-success-dim",
} as const

export function MediaFill(props: MediaFillProps) {
  if (props.fill === "frame") {
    return (
      <div data-slot="media-fill" data-fill="frame" className={cn("relative", props.className)}>
        {props.children}
        {props.pin !== undefined ? <PinnedLine>{props.pin}</PinnedLine> : null}
      </div>
    )
  }

  return (
    <div
      data-slot="media-fill"
      data-fill={props.fill}
      className={cn("relative aspect-video w-full overflow-hidden bg-sunken", props.className)}
    >
      {props.fill === "cover" ? (
        <video
          data-card-ignore=""
          className="h-full w-full object-cover"
          src={firstFrameUrl(props.src)}
          poster={props.poster}
          aria-label={props.label}
          muted
          playsInline
          preload="metadata"
          tabIndex={-1}
        />
      ) : (
        <div
          className={cn(
            "flex h-full w-full flex-col justify-between gap-2 border p-3",
            PLATE_TONE[props.tone ?? "neutral"],
          )}
        >
          <div className="flex flex-col gap-1">
            <span className="text-lg leading-tight font-semibold text-ink [overflow-wrap:anywhere]">
              {props.fields[0]}
            </span>
            {props.fields.slice(1).map((field, index) => (
              <span
                key={index}
                className="text-sm leading-snug text-ink-muted [overflow-wrap:anywhere]"
              >
                {field}
              </span>
            ))}
          </div>
          <span className="text-2xs font-medium tracking-[0.06em] uppercase text-dim">
            {props.label}
          </span>
        </div>
      )}
      {props.pin !== undefined ? <PinnedLine>{props.pin}</PinnedLine> : null}
    </div>
  )
}

/** Bottom-edge line — never adds height, always readable over either fill. */
function PinnedLine({ children }: { readonly children: ReactNode }) {
  return (
    <div
      data-slot="media-pin"
      className="absolute inset-x-0 bottom-0 flex items-center gap-2 px-3 py-1.5 text-xs text-ink [background-image:linear-gradient(to_top,var(--overlay-scrim),transparent)]"
    >
      {children}
    </div>
  )
}
