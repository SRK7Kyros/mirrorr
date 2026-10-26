import { useEffect, useMemo, useRef, useState, type DragEvent } from "react"
import { useSources } from "@/api"
import {
  baseCapture,
  captureLabel,
  catalogNaming,
  chainProblemSentence,
  chainTitle,
  moveRung,
  resolveChain,
  resolveRung,
  rungLabel,
  rungNames,
  normaliseRung,
  sourceLabel,
  type ChainBase,
  type ChainCatalog,
  type ChainCapture,
  type FallbackRung,
} from "@/api/domain/fallback-chain"
import {
  Button,
  Field,
  IconArrowDown,
  IconArrowUp,
  IconChevronRight,
  IconGrip,
  IconButton,
  IconSearch,
  IconX,
  Select,
  Tag,
  panelTitleClass,
} from "@/ui/components"
import { DiscoveryDrawer, canBrowseResolver } from "./discovery-drawer"
import { SourceFields } from "./source-chain"

interface RungDraft {
  readonly profileId: string
  readonly engineId: string
  readonly resolverId: string
  readonly resolverConfig: Record<string, unknown>
}

const EMPTY_DRAFT: RungDraft = { profileId: "", engineId: "", resolverId: "", resolverConfig: {} }

/**
 * The draft as a rung: only what the form actually names.
 *
 * A config travels with the resolver it belongs to, so it is sent only when the
 * user picked that resolver here — otherwise the server would use it to
 * override the config the profile above already brings.
 */
function draftRung(draft: RungDraft): FallbackRung | null {
  const rung: {
    profile_id?: number
    engine_id?: number
    resolver_id?: number
    resolver_config?: Record<string, unknown>
  } = {}
  if (draft.profileId !== "") rung.profile_id = Number(draft.profileId)
  if (draft.engineId !== "") rung.engine_id = Number(draft.engineId)
  if (draft.resolverId !== "") {
    rung.resolver_id = Number(draft.resolverId)
    rung.resolver_config = draft.resolverConfig
  }
  return rungNames(rung) ? rung : null
}

/** What a rung inherits when it names nothing — the profile's, else the run's own capture's. */
function inherited(
  profileId: string,
  own: ChainCapture,
  catalog: ChainCatalog,
): { capture: ChainCapture; profile: ChainCatalog["profiles"][number] | null } {
  const profile =
    profileId === "" ? null : (catalog.profiles.find((item) => item.id === Number(profileId)) ?? null)
  if (profile === null) return { capture: own, profile }
  return {
    profile,
    capture: {
      engine_id: profile.default_engine_id,
      resolver_id: profile.resolver_id,
      resolver_config: profile.resolver_config ?? {},
      profile_id: profile.id,
      profile_name: profile.name,
      retry_mode: profile.retry_mode ?? own.retry_mode,
      retry_config: profile.retry_config ?? {},
    },
  }
}

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
 * is inherited from its base — the profile when it names one, else the run's own
 * capture. The bottom editor is always the rung being written, and it shows what
 * that rung will actually run before it is added. Rungs are cards in a stack,
 * reordered by dragging one onto another or by the arrow buttons, which are the
 * keyboard and touch route to the same thing.
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
  const [draft, setDraft] = useState<RungDraft>(EMPTY_DRAFT)
  const [browseOpen, setBrowseOpen] = useState(false)
  const [open, setOpen] = useState(value.length > 0)
  const previousLength = useRef(value.length)
  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const naming = useMemo(() => catalogNaming({ ...catalog, sources }), [catalog, sources])
  const resolved = useMemo(() => resolveChain(value, base, catalog), [value, base, catalog])
  const own = useMemo(() => baseCapture(base), [base])
  const rung = draftRung(draft)
  const preview = rung === null ? null : resolveRung(rung, own, catalog)
  const candidate = useMemo(
    () => (rung === null ? null : resolveChain([...value, rung], base, catalog)),
    [rung, value, base, catalog],
  )
  const blocker =
    candidate !== null && candidate.problem !== null && candidate.problem.index === value.length
      ? candidate.problem
      : null
  const inheritedNow = inherited(draft.profileId, own, catalog)
  const chosenResolver =
    draft.resolverId === "" ? null : (catalog.resolvers.find((item) => String(item.id) === draft.resolverId) ?? null)
  const canBrowse = chosenResolver !== null && canBrowseResolver(chosenResolver)
  const step = value.length + 1
  const label = (text: string): string => `Fallback ${step} · ${text}`
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

  function patch(next: Partial<RungDraft>): void {
    setDraft((previous) => ({ ...previous, ...next }))
  }

  function commit(): void {
    if (rung === null || blocker !== null || disabled) return
    onChange([...value, normaliseRung(rung)])
    setDraft(EMPTY_DRAFT)
  }

  function startDrag(event: DragEvent<HTMLLIElement>, index: number): void {
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
          className={`shrink-0 text-ink-dim transition-transform ${open ? "rotate-90" : ""}`}
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
              {resolved.steps.map((entry, index) => {
                const name = rungLabel(entry.rung, naming)
                const runs = entry.capture === null ? null : captureLabel(entry.capture, base, naming)
                const target = over === index && dragging !== null && dragging !== index
                return (
                  <li
                    key={index}
                    draggable={!disabled}
                    onDragStart={(event) => startDrag(event, index)}
                    onDragOver={(event) => {
                      if (dragging === null) return
                      event.preventDefault()
                      event.dataTransfer.dropEffect = "move"
                      setOver(index)
                    }}
                    onDragLeave={() => setOver((current) => (current === index ? null : current))}
                    onDrop={(event) => dropOn(event, index)}
                    onDragEnd={endDrag}
                    data-problem={entry.problem?.kind}
                    data-dragging={dragging === index ? "true" : undefined}
                    data-drop-target={target ? "true" : undefined}
                    title={runs === null ? undefined : `Runs ${runs}`}
                    className={`flex items-center gap-2 rounded-xs border bg-surface-2 px-2 py-1.5 ${
                      entry.problem === null ? "border-line-subtle" : "border-warning bg-warning-dim"
                    } ${dragging === index ? "opacity-40" : ""} ${
                      target ? "border-brand shadow-ring" : ""
                    }`}
                  >
                    <span className="shrink-0 cursor-grab text-dim active:cursor-grabbing">
                      <IconGrip size={14} />
                    </span>
                    <Tag className="border-0 bg-transparent px-0 text-ink-dim">{index + 1}</Tag>
                    <div className="min-w-0 flex-1">
                      <p
                        className={`truncate text-sm ${entry.problem === null ? "text-ink" : "text-warning"}`}
                      >
                        {name}
                      </p>
                      {runs === null ? (
                        <p className="truncate text-xs text-warning">Names something no longer here.</p>
                      ) : runs === name ? null : (
                        <p className="truncate text-xs text-dim">Runs {runs}</p>
                      )}
                    </div>
                    <IconButton
                      label={`Move fallback ${index + 1} up`}
                      size="sm"
                      icon={<IconArrowUp size={13} />}
                      disabled={disabled || index === 0}
                      onClick={() => onChange(moveRung(value, index, index - 1))}
                    />
                    <IconButton
                      label={`Move fallback ${index + 1} down`}
                      size="sm"
                      icon={<IconArrowDown size={13} />}
                      disabled={disabled || index === value.length - 1}
                      onClick={() => onChange(moveRung(value, index, index + 1))}
                    />
                    <IconButton
                      label={`Remove fallback ${index + 1}`}
                      size="sm"
                      icon={<IconX size={13} />}
                      disabled={disabled}
                      onClick={() => onChange(value.filter((_, position) => position !== index))}
                    />
                  </li>
                )
              })}
            </ol>
          )}

          {resolved.problem === null ? null : (
            <p role="status" data-chain-problem={resolved.problem.kind} className="text-sm text-warning">
              {chainProblemSentence(resolved.problem, subject)}
            </p>
          )}

          <div className="flex flex-col gap-3 rounded-xs border border-line-subtle bg-surface-2 p-2.5">
            <p className="text-sm text-ink">Fallback {step}</p>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={label("Profile")}
                htmlFor={`${idPrefix}-fallback-profile`}
                hint="Optional — takes that profile whole."
              >
                <Select
                  id={`${idPrefix}-fallback-profile`}
                  value={draft.profileId}
                  disabled={disabled}
                  onChange={(event) => patch({ profileId: event.target.value })}
                >
                  <option value="">Change nothing from a profile…</option>
                  {catalog.profiles.map((profile) => (
                    <option key={profile.id} value={String(profile.id)}>
                      {profile.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label={label("Engine")} htmlFor={`${idPrefix}-fallback-engine`}>
                <Select
                  id={`${idPrefix}-fallback-engine`}
                  value={draft.engineId}
                  disabled={disabled}
                  onChange={(event) => patch({ engineId: event.target.value })}
                >
                  <option value="">Inherit — {naming.engine(inheritedNow.capture.engine_id)}</option>
                  {catalog.engines.map((engine) => (
                    <option key={engine.id} value={String(engine.id)}>
                      {engine.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <SourceFields
              key={step}
              idPrefix={`${idPrefix}-fallback`}
              formIdPrefix={`${idPrefix}-fallback-${step}`}
              resolvers={catalog.resolvers}
              value={{
                resolverId: draft.resolverId === "" ? null : Number(draft.resolverId),
                resolverConfig: draft.resolverConfig,
              }}
              onChange={(next) =>
                patch({
                  resolverId: next.resolverId === null ? "" : String(next.resolverId),
                  resolverConfig: next.resolverConfig,
                })
              }
              kindLabel={`How fallback ${step} takes its source`}
              labels={{ resolver: label("Source"), saved: label("Load a saved source") }}
              inherit={sourceLabel(
                inheritedNow.capture.resolver_id,
                inheritedNow.capture.resolver_config,
                naming,
              )}
              disabled={disabled}
              browse={
                canBrowse ? (
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      icon={<IconSearch size={15} />}
                      disabled={disabled}
                      onClick={() => setBrowseOpen(true)}
                    >
                      Browse {chosenResolver.name}…
                    </Button>
                  </div>
                ) : null
              }
            />

            <p className="text-sm text-ink-dim" data-chain-preview={preview === null ? "empty" : "runs"}>
              {preview === null ? (
                "Name a profile, an engine or a source to add a fallback."
              ) : preview.ok ? (
                <>
                  Runs <span className="text-ink">{captureLabel(preview.capture, base, naming)}</span>
                </>
              ) : (
                <span className="text-warning">That names something no longer here.</span>
              )}
            </p>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="primary"
                disabled={disabled || rung === null || blocker !== null}
                onClick={commit}
              >
                Add fallback
              </Button>
              {blocker === null ? null : (
                <span className="text-xs text-dim">{chainProblemSentence(blocker, subject)}</span>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <DiscoveryDrawer
        open={browseOpen}
        onClose={() => setBrowseOpen(false)}
        resolver={chosenResolver}
        onUse={(item) => {
          patch({ resolverConfig: item.config ?? {} })
          setBrowseOpen(false)
        }}
      />
    </section>
  )
}
