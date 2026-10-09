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
    <div className={cn("session-preview-box", className)}>
      <SessionPreview src={src} active={previewing} loop={loop} />
      {src !== null ? (
        <button
          type="button"
          className="session-preview-toggle"
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
