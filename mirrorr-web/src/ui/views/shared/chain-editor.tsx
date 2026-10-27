import { useEffect, useMemo, useRef, useState, type DragEvent } from "react"
import { useSources } from "@/api"
import {
  baseCapture,
  captureLabel,
  catalogNaming,
  chainTitle,
  moveRung,
  resolveChain,
  type ChainBase,
  type ChainCatalog,
  type FallbackRung,
} from "@/api/domain/fallback-chain"
import { IconChevronRight, Tag, panelTitleClass } from "@/ui/components"
import { cn } from "@/ui/lib/cn"
import { RungCard, draftRung, type RungDraft, type RungPreview } from "./rung-card"

export interface ChainEditorProps {
  readonly idPrefix: string
  readonly catalog: ChainCatalog
  /** The capture before the chain — the run's, or the profile's own. */
  readonly base: ChainBase
  /** Rungs in the order they are tried. */
  readonly value: readonly FallbackRung[]
  readonly onChange: (next: FallbackRung[]) => void
  readonly disabled?: boolean
  /** Who owns the capture before the chain — it decides how a clash is worded. */
  readonly subject?: "run" | "profile"
}

/**
 * The chain tried after a capture, built one rung at a time and kept folded away
 * until there is something in it — most runs have none, and the section is
 * optional everywhere it is mounted.
 *
 * A rung is a *patch*, not a kind of thing: it may name a profile, a different
 * engine, a different source, or any combination, and whatever it leaves blank
 * is inherited from the run's own capture — never from the rung above it. So a
 * stored rung and the one being written are drawn by the same card: collapsed it
 * says what it changes and what it runs instead, expanded it is the form. Rungs
 * are reordered by dragging a card's grip onto another card or by the arrow
 * buttons, which are the keyboard and touch route to the same thing.
 */
export function ChainEditor({
  idPrefix,
  catalog,
  base,
  value,
  onChange,
  disabled = false,
  subject = "run",
}: ChainEditorProps) {
  const sources = useSources()
  const [open, setOpen] = useState(value.length > 0)
  const previousLength = useRef(value.length)
  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const naming = useMemo(() => catalogNaming({ ...catalog, sources }), [catalog, sources])
  const own = useMemo(() => baseCapture(base), [base])
  const step = value.length + 1
  const bodyId = `${idPrefix}-fallbacks`
  const summary =
    value.length === 0
      ? subject === "profile"
        ? "None — only its own capture runs."
        : "None — only the run's own capture runs."
      : chainTitle(value, naming)

  useEffect(() => {
    if (value.length > previousLength.current) setOpen(true)
    previousLength.current = value.length
  }, [value.length])

  /**
   * What a draft would run in the position it is headed for — the chain with that
   * one rung written in, read back at that rung.
   */
  function evaluate(index: number | null, draft: RungDraft): RungPreview {
    const rung = draftRung(draft)
    if (rung === null) return { capture: null, problem: null }
    const at = index === null ? value.length : index
    const next =
      index === null ? [...value, rung] : value.map((item, position) => (position === index ? rung : item))
    const entry = resolveChain(next, base, catalog).steps[at]
    return entry ?? { capture: null, problem: null }
  }

  function startDrag(event: DragEvent<HTMLElement>, index: number): void {
    if (disabled) return
    setDragging(index)
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("text/plain", String(index))
  }

  function dropOn(event: DragEvent<HTMLLIElement>, index: number): void {
    event.preventDefault()
    const from = dragging ?? Number(event.dataTransfer.getData("text/plain"))
    if (Number.isInteger(from)) onChange(moveRung(value, from, index))
    setDragging(null)
    setOver(null)
  }

  function endDrag(): void {
    setDragging(null)
    setOver(null)
  }

  return (
    <section
      className="flex flex-col rounded-xs border border-line-subtle bg-surface-1"
      data-chain-section={open ? "open" : "closed"}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-2 rounded-xs px-2.5 py-2 text-left hover:bg-surface-2"
      >
        <IconChevronRight
          size={15}
          className={cn("shrink-0 text-ink-dim transition-transform", open && "rotate-90")}
        />
        <span role="heading" aria-level={3} className={panelTitleClass}>
          Fallbacks
        </span>
        <Tag className={value.length === 0 ? "text-dim" : undefined}>
          {value.length === 0 ? "optional" : value.length}
        </Tag>
        <span className="min-w-0 flex-1 truncate text-right text-xs text-ink-dim">{summary}</span>
      </button>

      {open ? (
        <div id={bodyId} className="flex flex-col gap-3 border-t border-line-subtle p-2.5">
          <p className="text-sm text-ink-dim">
            Tried in this order after its own capture. A rung changes only what it names — anything
            left blank comes from that first capture, never from the rung above it.
          </p>

          <div
            className="flex items-center gap-2 rounded-xs border border-dashed border-line-strong bg-surface-2 px-2 py-1.5"
            data-chain-base
          >
            <Tag className="border-0 bg-transparent px-0 text-ink-dim">first</Tag>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-ink">
                {subject === "profile" ? "This profile's own capture" : "The run's own capture"}
              </p>
              <p className="truncate text-xs text-dim">{captureLabel(own, base, naming)}</p>
            </div>
          </div>

          {value.length === 0 ? (
            <p className="text-sm text-dim">Nothing after it — add a fallback below if it should.</p>
          ) : (
            <ol className="flex flex-col gap-1.5" aria-label="Fallback chain, in order">
              {value.map((rung, index) => {
                const target = over === index && dragging !== null && dragging !== index
                return (
                  <li
                    key={index}
                    onDragOver={(event) => {
                      if (dragging === null) return
                      event.preventDefault()
                      event.dataTransfer.dropEffect = "move"
                      setOver(index)
                    }}
                    onDragLeave={() => setOver((current) => (current === index ? null : current))}
                    onDrop={(event) => dropOn(event, index)}
                    data-drop-target={target ? "true" : undefined}
                    className={cn("rounded-xs", target && "shadow-ring")}
                  >
                    <RungCard
                      kind="saved"
                      number={index + 1}
                      idPrefix={idPrefix}
                      rung={rung}
                      catalog={catalog}
                      naming={naming}
                      base={base}
                      subject={subject}
                      disabled={disabled}
                      resolve={(draft) => evaluate(index, draft)}
                      onApply={(next) =>
                        onChange(value.map((item, position) => (position === index ? next : item)))
                      }
                      actions={{
                        canMoveUp: index > 0,
                        canMoveDown: index < value.length - 1,
                        onMoveUp: () => onChange(moveRung(value, index, index - 1)),
                        onMoveDown: () => onChange(moveRung(value, index, index + 1)),
                        onRemove: () => onChange(value.filter((_, position) => position !== index)),
                        dragging: dragging === index,
                        onDragStart: (event) => startDrag(event, index),
                        onDragEnd: endDrag,
                      }}
                    />
                  </li>
                )
              })}
            </ol>
          )}

          <RungCard
            kind="draft"
            number={step}
            idPrefix={idPrefix}
            rung={null}
            catalog={catalog}
            naming={naming}
            base={base}
            subject={subject}
            disabled={disabled}
            resolve={(draft) => evaluate(null, draft)}
            onApply={(next) => onChange([...value, next])}
          />
        </div>
      ) : null}
    </section>
  )
}
