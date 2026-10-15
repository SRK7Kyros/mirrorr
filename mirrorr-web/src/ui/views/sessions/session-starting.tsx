import { Spinner } from "@/ui/components"
import { cn } from "@/ui/lib/cn"

/**
 * The loading affordance shown while a session's stream is not playable yet
 * (`isStarting`). It is the gate that keeps every player — iframe, hls.js
 * `<video>` — unmounted until the playlist exists. The visible copy is
 * decorative; the single announcement lives in the `role="status"` region
 * below, the same live-region shape `videojs/ui/status-announcer.tsx` renders
 * (a `role="status"` div holding one content span), reused here because that
 * component needs a video.js player context we deliberately do not mount.
 */
export function SessionStarting({
  label,
  className,
}: {
  readonly label: string
  readonly className?: string
}) {
  return (
    <div
      data-slot="session-starting"
      className={cn("grid place-items-center bg-sunken", className)}
    >
      <div role="status" className="sr-only">
        {label}
      </div>
      <div aria-hidden="true" className="flex flex-col items-center gap-2 text-dim">
        <Spinner />
        <span className="text-sm">{label}</span>
      </div>
    </div>
  )
}
