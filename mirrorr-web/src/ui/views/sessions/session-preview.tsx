import { useEffect, useRef } from "react"
import Hls from "hls.js"
import { cn } from "@/ui/lib/cn"

/** Whether the user asked the OS to reduce motion — previews never autoplay then. */
function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/**
 * Lazy HLS preview for one session card. The `<video>` is always mounted but
 * only attaches hls.js (and plays, muted) while `active` — the pointer or focus
 * is on the card — and tears the player down on leave, so a grid holds no
 * decoder at rest and only the hovered card decodes.
 */
export function SessionPreview({
  src,
  active,
  loop,
  className,
}: {
  readonly src: string | null
  readonly active: boolean
  readonly loop: boolean
  readonly className?: string
}) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = ref.current
    if (video === null || src === null || !active) return

    let hls: Hls | null = null
    if (video.canPlayType("application/vnd.apple.mpegurl") !== "") {
      // Safari (and iOS) play HLS natively — no hls.js needed.
      video.src = src
    } else if (Hls.isSupported()) {
      hls = new Hls({ maxBufferLength: 4, backBufferLength: 0, capLevelToPlayerSize: true })
      hls.loadSource(src)
      hls.attachMedia(video)
    } else {
      return
    }

    if (!prefersReducedMotion()) void video.play().catch(() => undefined)

    return () => {
      hls?.destroy()
      video.pause()
      video.removeAttribute("src")
      video.load()
    }
  }, [src, active])

  return (
    <video
      ref={ref}
      className={cn("session-preview", className)}
      data-active={active}
      muted
      loop={loop}
      playsInline
      preload="none"
      aria-hidden="true"
      tabIndex={-1}
    />
  )
}
