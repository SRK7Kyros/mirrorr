import { useEffect, useRef, useState, type ReactNode } from "react"
import { IconPlay, IconX } from "@/ui/components"
import { cn } from "@/ui/lib/cn"
import { SessionPlayer } from "./session-player"
import { SessionPreview } from "./session-preview"
import { SessionStarting } from "./session-starting"

const CENTER_BUTTON =
  "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 grid place-items-center size-[46px] p-0 border border-line-strong rounded-full bg-[var(--overlay-scrim)] text-ink cursor-pointer transition-[translate,scale,background-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-surface-3 hover:scale-[1.06]"

/**
 * The session's own `player.html` page, embedded so playback — with its
 * controls and fullscreen — never leaves the console. Same-origin under
 * `/content/`, so no cross-origin issues; inside the mobile shell the player
 * stays in the app instead of escaping to a browser. Fallback for sessions
 * that published an HTML page but no direct stream URL — everywhere else the
 * native `SessionPlayer` component renders instead.
 */
export function SessionPlayerFrame({
  url,
  label,
  className,
}: {
  readonly url: string
  readonly label: string
  readonly className?: string
}) {
  return (
    <iframe
      src={url}
      title={`${label} player`}
      className={cn("block aspect-video w-full border-0 bg-sunken", className)}
      allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
      allowFullScreen
      loading="lazy"
    />
  )
}

/**
 * The preview box, shared by session cards, recording cards, and the session
 * detail page. The stream attaches when the box scrolls into view so the
 * first frame is already there as a thumbnail; `hovering` plays it muted
 * where a pointer exists, and tapping the center button pins playback for
 * touch devices — there is no stop button, leaving (or navigating away)
 * stops it. When the session published its `player.html` page the button
 * opens the native player (controls, rewind, fullscreen) embedded instead;
 * `badge` moves into the player's top-left corner because the skin owns the
 * right side and the bottom bar.
 *
 * The box is a navigation dead zone: it carries `data-card-ignore`, which the
 * session and recording cards list among the descendants whose clicks they must
 * not hijack, so a tap on the bare video never opens the card — only the card
 * body outside the preview does.
 *
 * While `loading` (the caller's `isStarting` gate) no player is mounted at all:
 * the box shows the `SessionStarting` affordance instead of attaching hls.js to
 * a playlist the engine has not written yet.
 */
export function SessionPreviewPlayer({
  src,
  htmlUrl,
  loop,
  hovering = false,
  loading = false,
  loadingLabel,
  label,
  badge,
  className,
  children,
}: {
  readonly src: string | null
  readonly htmlUrl: string | null
  readonly loop: boolean
  readonly hovering?: boolean
  readonly loading?: boolean
  readonly loadingLabel?: string
  readonly label: string
  readonly badge?: ReactNode
  readonly className?: string
  readonly children?: ReactNode
}) {
  const [locked, setLocked] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [visible, setVisible] = useState(
    () => typeof IntersectionObserver !== "function",
  )
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (visible) return
    const el = boxRef.current
    if (el === null || typeof IntersectionObserver !== "function") {
      setVisible(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true)
          io.disconnect()
        }
      },
      { rootMargin: "200px" },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [visible])

  const previewing = hovering || locked
  const canExpand = htmlUrl !== null

  return (
    <div
      ref={boxRef}
      data-card-ignore=""
      className={cn("relative aspect-video bg-sunken overflow-hidden", className)}
      onMouseLeave={() => setLocked(false)}
    >
      {loading ? (
        <>
          <SessionStarting
            label={loadingLabel ?? label}
            className="absolute inset-0"
          />
          {children}
        </>
      ) : expanded && canExpand ? (
        <>
          {src !== null ? (
            <SessionPlayer
              src={src}
              label={label}
              className="absolute inset-0 h-full"
            />
          ) : (
            <SessionPlayerFrame
              url={htmlUrl}
              label={label}
              className="absolute inset-0 h-full"
            />
          )}
          <div className="absolute left-0 top-0 flex items-center gap-2 p-2">
            {badge}
            <button
              type="button"
              className="grid place-items-center size-[28px] p-0 border border-line-strong rounded-full bg-[var(--overlay-scrim)] text-ink cursor-pointer hover:bg-surface-3"
              aria-label={`Close ${label} player`}
              onClick={() => setExpanded(false)}
            >
              <IconX size={14} />
            </button>
          </div>
        </>
      ) : (
        <>
          <SessionPreview src={src} load={visible} active={previewing} loop={loop} />
          {src !== null ? (
            <button
              type="button"
              className={CENTER_BUTTON}
              aria-label={canExpand ? `Play ${label} with controls` : `Preview ${label}`}
              onClick={() => {
                if (canExpand) setExpanded(true)
                else setLocked(true)
              }}
            >
              <IconPlay size={24} />
            </button>
          ) : null}
          {children}
        </>
      )}
    </div>
  )
}
