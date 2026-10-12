import { useEffect, useRef } from "react";
import Hls from "hls.js";
import { cn } from "@/ui/lib/cn";

/** Whether the user asked the OS to reduce motion — previews never autoplay then. */
function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Lazy preview for one media card. The `<video>` is always mounted but only
 * attaches a player (and plays, muted) while `active` — the pointer or focus is
 * on the card — and tears it down on leave, so a grid holds no decoder at rest
 * and only the hovered card decodes. HLS playlists go through hls.js; plain
 * media files (recordings) play through the element itself.
 */
export function SessionPreview({
  src,
  active,
  loop,
  className,
}: {
  readonly src: string | null;
  readonly active: boolean;
  readonly loop: boolean;
  readonly className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (video === null || src === null || !active) return;

    let hls: Hls | null = null;
    const isHls = /\.m3u8([?#]|$)/i.test(src);
    if (!isHls || video.canPlayType("application/vnd.apple.mpegurl") !== "") {
      // A progressive media file, or HLS that Safari/iOS play natively — the
      // element handles both without hls.js.
      video.src = src;
    } else if (Hls.isSupported()) {
      hls = new Hls({
        maxBufferLength: 4,
        backBufferLength: 0,
        capLevelToPlayerSize: true,
      });
      hls.loadSource(src);
      hls.attachMedia(video);
    } else {
      return;
    }

    if (!prefersReducedMotion()) void video.play().catch(() => undefined);

    return () => {
      hls?.destroy();
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [src, active]);

  return (
    <video
      ref={ref}
      className={cn(
      "session-preview block w-full h-full object-cover opacity-0 transition-opacity duration-[var(--dur-med)] ease-[var(--ease-out)] data-[active=true]:opacity-100",
      className,
    )}
      data-active={active}
      muted
      loop={loop}
      playsInline
      preload="none"
      aria-hidden="true"
      tabIndex={-1}
    />
  );
}
