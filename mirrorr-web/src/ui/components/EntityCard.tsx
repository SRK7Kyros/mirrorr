import type { MouseEvent, ReactNode } from "react"
import { cn } from "@/ui/lib/cn"

/**
 * Descendants that own their own click — a card click must not hijack them.
 * `[data-card-ignore]` marks a media surface (the preview player) that is never
 * a navigation target.
 */
export const CARD_INTERACTIVE =
  "a, button, input, select, textarea, label, summary, [role='menu'], [role='menuitem'], [data-card-ignore]"

export interface EntityCardProps {
  /** Slot 1 — status chip plus the `⋯` overflow. Always occupies the top edge. */
  readonly header: ReactNode
  /**
   * Slot 2 — the 16:9 media box. A surface that has one always renders it, in
   * one of the three closed fills (`frame` · `cover` · `plate`); a surface with
   * nothing to show (Autoruns) omits it and the slot collapses.
   */
  readonly media?: ReactNode
  /** Slot 3 — the surface's headline metric (elapsed · duration · reason). */
  readonly hero?: ReactNode
  /** Slot 4 — at most one detail block. The last slot before the identity. */
  readonly detail?: ReactNode
  /** Slot 5 — title and its meta line. Always the bottom edge of the content. */
  readonly identity: ReactNode
  /** Slot 6 — inline verbs that belong to the surface's primary action. */
  readonly footer?: ReactNode
  readonly selected?: boolean
  /** Machine-readable reason the card is flagged; the detail slot carries the copy. */
  readonly issue?: string | null
  /** Whole-card navigation. Interactive descendants are excluded. */
  readonly onOpen?: () => void
  readonly className?: string
  readonly labelledBy?: string
}

const CARD_BASE =
  "entity-card group relative flex h-full min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface-2 " +
  "transition-[border-color,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out)] " +
  "hover:border-line-strong hover:shadow-elev-md " +
  "data-[selected=true]:border-brand data-[selected=true]:shadow-[0_0_0_1px_var(--accent-dim)] " +
  "data-[issue]:border-[color:rgba(227,179,65,0.45)]"

/**
 * The one card skeleton for Sessions, Autoruns and Recordings.
 *
 * A card is a column of six **ordered** slots; each surface declares its recipe
 * (which slots it passes). Order and the top/bottom edges are invariant, so the
 * eye learns one card instead of three. An omitted slot collapses — except
 * `media`, which is always a 16:9 box when a surface declares it, because the
 * card must not change height when a run goes live or finishes.
 */
export function EntityCard({
  header,
  media,
  hero,
  detail,
  identity,
  footer,
  selected = false,
  issue,
  onOpen,
  className,
  labelledBy,
}: EntityCardProps) {
  function handleClick(event: MouseEvent<HTMLElement>) {
    if (onOpen === undefined) return
    if ((event.target as HTMLElement).closest(CARD_INTERACTIVE) !== null) return
    if (window.getSelection()?.toString() !== "") return
    onOpen()
  }

  return (
    <article
      data-slot="entity-card"
      data-selected={selected ? "true" : undefined}
      data-issue={issue !== undefined && issue !== null && issue !== "" ? issue : undefined}
      aria-labelledby={labelledBy}
      className={cn(CARD_BASE, onOpen !== undefined && "cursor-pointer", className)}
      onClick={handleClick}
    >
      <div data-slot="header" className="flex min-h-11 items-center gap-2 px-4 pt-3">
        {header}
      </div>

      {media !== undefined ? (
        <div data-slot="media" className="px-0 pt-3">
          {media}
        </div>
      ) : null}

      <div data-slot="hero" className="px-4 pt-3 empty:hidden">
        {hero}
      </div>

      {detail !== undefined ? (
        <div data-slot="detail" className="px-4 pt-2.5 empty:hidden">
          {detail}
        </div>
      ) : null}

      <div data-slot="identity" className="mt-auto min-w-0 px-4 pt-3">
        {identity}
      </div>

      {footer !== undefined ? (
        <div data-slot="footer" className="flex items-center gap-2 px-4 pt-3 pb-3 empty:hidden">
          {footer}
        </div>
      ) : (
        <div className="pb-3" aria-hidden="true" />
      )}
    </article>
  )
}
