import { useState } from "react"
import { HlsJsVideo } from "@videojs/react/media/hlsjs-video"
import { VideoPlayer } from "@videojs/react/video"
import { VideoSkin } from "@/ui/components/videojs/video/skin"
import { cn } from "@/ui/lib/cn"

/**
 * The in-console player: Video.js `video` preset (default skin source, HLS
 * media) rendered as a component. Autoplays muted, like `player.html` did —
 * and the 10-second rewind is a native skin control now (`SeekButton`,
 * `seconds={-10}` in the skin source) instead of an overlay.
 */
export function SessionPlayer({
  src,
  label,
  className,
}: {
  readonly src: string
  readonly label: string
  readonly className?: string
}) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <div
        data-slot="player-fallback"
        className={cn(
          "flex aspect-video w-full flex-col items-center justify-center gap-2 bg-sunken px-6 text-center",
          className,
        )}
      >
        <span className="text-base font-medium text-ink">This preview could not be played</span>
        <span className="text-sm text-ink-muted">
          The stream may have moved, or the file may still be publishing.
        </span>
        <a
          className="tab-stop mt-1 inline-flex min-h-11 items-center px-3 text-sm font-medium text-brand underline underline-offset-4 hover:text-ink"
          href={src}
          target="_blank"
          rel="noreferrer"
        >
          Open the file
        </a>
      </div>
    )
  }

  return (
    <VideoPlayer>
      <VideoSkin className={cn("aspect-video w-full", className)}>
        <HlsJsVideo
          src={src}
          autoPlay
          muted
          playsInline
          preload="auto"
          aria-label={`${label} player`}
          onError={() => setFailed(true)}
        />
      </VideoSkin>
    </VideoPlayer>
  )
}
