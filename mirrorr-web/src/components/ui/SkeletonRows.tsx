/**
 * SkeletonRows — the single loading placeholder (spec L408). The per-view
 * geometry lives in `SKELETON_PRESETS`: V3 sessions is 5 rows, V7 recordings
 * is 8 cards (spec L269, L317). The grid matches the recordings card list.
 */

export const SKELETON_PRESETS = {
  sessions: { variant: "rows", count: 5 },
  recordings: { variant: "cards", count: 8 },
} as const

export type SkeletonVariant = (typeof SKELETON_PRESETS)[keyof typeof SKELETON_PRESETS]["variant"]

export interface SkeletonRowsProps {
  readonly variant?: SkeletonVariant
  readonly count?: number
  readonly label?: string
}

export function SkeletonRows({ variant = "rows", count = 5, label = "Loading" }: SkeletonRowsProps) {
  const placeholders = Array.from({ length: count }, (_, index) => index)

  if (variant === "cards") {
    return (
      <div
        data-testid="skeletons"
        role="status"
        aria-label={label}
        aria-busy="true"
        className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4"
      >
        {placeholders.map((index) => (
          <div
            key={index}
            data-testid="skeleton-card"
            aria-hidden="true"
            className="h-28 rounded-surface border border-border bg-bg-raised"
          />
        ))}
      </div>
    )
  }

  return (
    <div
      data-testid="skeletons"
      role="status"
      aria-label={label}
      aria-busy="true"
      className="flex flex-col gap-2"
    >
      {placeholders.map((index) => (
        <div
          key={index}
          data-testid="skeleton-row"
          aria-hidden="true"
          className="h-9 rounded-control bg-bg-overlay"
        />
      ))}
    </div>
  )
}
