import { cn } from "@/ui/lib/cn"
import { getStatusDescriptor, type StatusDot as StatusDotKind, type StatusTone } from "@/api/status"
import { IconCheck, IconX } from "./icons"

/**
 * Tone → hue. The chip and dot each publish `--chip-hue` from their own
 * `data-tone`, and the children, the keyframes and the dot read it back — the
 * same single indirection the CSS used. Written as whole literals so Tailwind's
 * scanner can see every class name.
 */
const TONE_HUE = [
  "data-[tone=primary]:[--chip-hue:var(--accent)]",
  "data-[tone=success]:[--chip-hue:var(--success)]",
  "data-[tone=warning]:[--chip-hue:var(--warning)]",
  "data-[tone=danger]:[--chip-hue:var(--danger)]",
  "data-[tone=secondary]:[--chip-hue:var(--secondary)]",
  "data-[tone=neutral]:[--chip-hue:var(--neutral)]",
].join(" ")

/** Colour-free dot — publishes `--chip-hue`, pulses or spins for its kind. */
export function StatusDot({
  tone,
  dot = "static",
  className,
}: {
  readonly tone: StatusTone
  readonly dot?: StatusDotKind
  readonly className?: string
}) {
  return (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full",
        dot === "pulse" && "bg-[color:var(--chip-hue)] animate-[dot-pulse_1.6s_var(--ease-in-out)_infinite]",
        dot === "spinner" &&
          "border-2 border-x-[color:var(--chip-hue)] border-b-[color:var(--chip-hue)] border-t-transparent bg-transparent animate-[spin_0.7s_linear_infinite]",
        dot === "static" && "bg-[color:var(--chip-hue)]",
        TONE_HUE,
        className,
      )}
      data-tone={tone}
      data-dot={dot}
      aria-hidden="true"
    />
  )
}

/**
 * Status chip — resolves any server status through `STATUS_MAP` so no view
 * invents labels or tones. The bar + icon double the colour signal (never
 * colour alone), per the design-system rule.
 */
export function StatusChip({ status, className }: { readonly status: string; readonly className?: string }) {
  const descriptor = getStatusDescriptor(status)
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-2 rounded-sm border border-line bg-surface-3 pl-1 pr-2 text-sm font-medium whitespace-nowrap text-ink",
        TONE_HUE,
        className,
      )}
      data-tone={descriptor.tone}
      data-status={status}
    >
      <span
        className="my-[3px] w-[3px] self-stretch rounded-full bg-[color:var(--chip-hue)]"
        aria-hidden="true"
      />
      {descriptor.icon !== undefined ? (
        <span className="grid size-4 place-content-center text-[color:var(--chip-hue)]" aria-hidden="true">
          {descriptor.icon === "check" ? <IconCheck size={13} /> : <IconX size={13} />}
        </span>
      ) : (
        <span className="grid size-4 place-content-center text-[color:var(--chip-hue)]" aria-hidden="true">
          <StatusDot tone={descriptor.tone} dot={descriptor.dot} />
        </span>
      )}
      <span className="pr-1">{descriptor.label}</span>
    </span>
  )
}