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
        />
      </VideoSkin>
    </VideoPlayer>
  )
}
