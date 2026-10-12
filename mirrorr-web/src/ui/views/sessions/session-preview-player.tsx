import { useState, type ReactNode } from "react"
import { IconPause, IconPlay } from "@/ui/components"
import { cn } from "@/ui/lib/cn"
import { SessionPreview } from "./session-preview"

/**
 * The preview box and its toggle, shared by the session card and the detail
 * page. `hovering` lets a pointer device preview on hover; the button pins the
 * preview so touch devices — which have no hover — can start it too.
 */
export function SessionPreviewPlayer({
  src,
  loop,
  hovering = false,
  autoPlay = false,
  label,
  className,
  children,
}: {
  readonly src: string | null
  readonly loop: boolean
  readonly hovering?: boolean
  readonly autoPlay?: boolean
  readonly label: string
  readonly className?: string
  readonly children?: ReactNode
}) {
  const [playing, setPlaying] = useState(autoPlay)
  const previewing = hovering || playing

  return (
    <div className={cn("relative aspect-video bg-sunken overflow-hidden", className)}>
      <SessionPreview src={src} active={previewing} loop={loop} />
      {src !== null ? (
        <button
          type="button"
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 grid place-items-center size-[46px] p-0 border border-line-strong rounded-full bg-[var(--overlay-scrim)] text-ink cursor-pointer transition-[translate,scale,background-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-surface-3 hover:scale-[1.06]"
          aria-label={playing ? `Stop preview of ${label}` : `Preview ${label}`}
          aria-pressed={playing}
          onClick={() => setPlaying((value) => !value)}
        >
          {previewing ? <IconPause size={24} /> : <IconPlay size={24} />}
        </button>
      ) : null}
      {children}
    </div>
  )
}
