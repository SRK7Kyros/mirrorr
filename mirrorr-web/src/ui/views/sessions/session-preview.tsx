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
 * Lazy preview for one media card. The `<video>` attaches its player when
 * `load` turns true (the card scrolled into view), so the first frame is
 * already there as a thumbnail — and it only plays, muted, while `active`.
 * Playback starts on MANIFEST_PARSED (`canplay` for native sources), never
 * blindly after attach: playing before the manifest is ready is what used to
 * leave hovered cards stuck on a loaded-but-paused frame.
 */
export function SessionPreview({
  src,
  load,
  active,
  loop,
  className,
}: {
  readonly src: string | null;
  readonly load: boolean;
  readonly active: boolean;
  readonly loop: boolean;
  readonly className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const video = ref.current;
    if (video === null || src === null || !load) return;

    let hls: Hls | null = null;
    let cancelled = false;
    const tryPlay = () => {
      if (cancelled || !activeRef.current || prefersReducedMotion()) return;
      void video.play().catch(() => undefined);
    };
    const isHls = /\.m3u8([?#]|$)/i.test(src);
    const cleanups: Array<() => void> = [];
    if (!isHls || video.canPlayType("application/vnd.apple.mpegurl") !== "") {
      // A progressive media file, or HLS that Safari/iOS play natively — the
      // element handles both without hls.js.
      video.src = src;
      if (video.readyState >= 3) {
        tryPlay();
      } else {
        video.addEventListener("canplay", tryPlay, { once: true });
        cleanups.push(() => video.removeEventListener("canplay", tryPlay));
      }
    } else if (Hls.isSupported()) {
      hls = new Hls({
        maxBufferLength: 4,
        backBufferLength: 0,
        capLevelToPlayerSize: true,
      });
      hls.on(Hls.Events.MANIFEST_PARSED, tryPlay);
      hls.loadSource(src);
      hls.attachMedia(video);
    } else {
      return;
    }

    return () => {
      cancelled = true;
      for (const clean of cleanups) clean();
      hls?.destroy();
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [src, load]);

  useEffect(() => {
    const video = ref.current;
    if (video === null || src === null || !load || video.currentSrc === "")
      return;
    if (active && !prefersReducedMotion()) {
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }, [src, load, active]);

  return (
    <video
      ref={ref}
      className={cn(
      "session-preview block w-full h-full object-cover opacity-0 transition-opacity duration-[var(--dur-med)] ease-[var(--ease-out)] data-[active=true]:opacity-100 data-[loaded=true]:opacity-100",
      className,
    )}
      data-active={active}
      data-loaded={load && src !== null}
      muted
      loop={loop}
      playsInline
      preload="metadata"
      aria-hidden="true"
      tabIndex={-1}
    />
  );
}
