import { useState, type DragEvent } from "react"
import {
  baseCapture,
  captureLabel,
  chainProblemSentence,
  normaliseRung,
  rungChanges,
  rungNames,
  sourceLabel,
  type ChainBase,
  type ChainCapture,
  type ChainCatalog,
  type ChainNaming,
  type ChainProblem,
  type FallbackRung,
} from "@/api/domain/fallback-chain"
import { canonicalJson } from "@/api/domain/fallback-sources"
import { formatRelativeTime } from "@/api/time"
import type { ProbeVerdicts } from "@/api/hooks"
import {
  Button,
  Field,
  IconArrowDown,
  IconArrowRight,
  IconArrowUp,
  IconChevronRight,
  IconGrip,
  IconSearch,
  IconX,
  IconButton,
  Select,
  Tag,
} from "@/ui/components"
import { cn } from "@/ui/lib/cn"
import { DiscoveryDrawer, canBrowseResolver } from "./discovery-drawer"
import { SourceFields } from "./source-chain"

/**
 * One rung while the form holds it — every field is a string id, blank meaning
 * "leave what the capture it patches already has".
 */
export interface RungDraft {
  readonly profileId: string
  readonly engineId: string
  readonly resolverId: string
  readonly resolverConfig: Record<string, unknown>
}

export const EMPTY_DRAFT: RungDraft = {
  profileId: "",
  engineId: "",
  resolverId: "",
  resolverConfig: {},
}

/** A stored rung as the form holds it. */
export function draftOf(rung: FallbackRung): RungDraft {
  return {
    profileId: rung.profile_id == null ? "" : String(rung.profile_id),
    engineId: rung.engine_id == null ? "" : String(rung.engine_id),
    resolverId: rung.resolver_id == null ? "" : String(rung.resolver_id),
    resolverConfig: rung.resolver_config ?? {},
  }
}

/**
 * The draft as a rung: only what the form actually names.
 *
 * A config travels with the resolver it belongs to, so it is sent only when the
 * user picked that resolver here — otherwise the server would use it to
 * override the config the capture it patches already brings.
 */
export function draftRung(draft: RungDraft): FallbackRung | null {
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

/** What a rung would run, or why it cannot — what its card shows before it is kept. */
export interface RungPreview {
  readonly capture: ChainCapture | null
  readonly problem: ChainProblem | null
}

/** The reorder and remove affordances a stored rung has and the draft does not. */
export interface RungActions {
  readonly canMoveUp: boolean
  readonly canMoveDown: boolean
  readonly onMoveUp: () => void
  readonly onMoveDown: () => void
  readonly onRemove: () => void
  readonly dragging: boolean
  readonly onDragStart: (event: DragEvent<HTMLElement>) => void
  readonly onDragEnd: () => void
}

export interface RungCardProps {
  /** `saved` is a rung in the chain; `draft` is the one being written at its end. */
  readonly kind: "saved" | "draft"
  /** Position in the chain, one-based — what its heading and its field ids say. */
  readonly number: number
  readonly idPrefix: string
  /** The stored rung, or `null` for the draft. */
  readonly rung: FallbackRung | null
  readonly catalog: ChainCatalog
  readonly naming: ChainNaming
  readonly base: ChainBase
  readonly subject: "run" | "profile"
  readonly disabled: boolean
  readonly resolve: (draft: RungDraft) => RungPreview
  readonly onApply: (rung: FallbackRung) => void
  readonly actions?: RungActions
  /** What is known about this rung's capture, and the way to check it again. */
  readonly probe?: ProbeVerdicts
}

/**
 * One rung of the chain, in the one shape it is always drawn: collapsed it is a
 * summary of what it changes and what it runs instead, expanded it is the form
 * that edits it.
 *
 * The same component writes a new rung and edits a stored one, because they are
 * the same thing — a rung is a patch over the run's own capture, so changing one
 * field of an existing rung is the same act as filling in a new one.
 */
export function RungCard({
  kind,
  number,
  idPrefix,
  rung,
  catalog,
  naming,
  base,
  subject,
  disabled,
  resolve,
  onApply,
  actions,
  probe,
}: RungCardProps) {
  const seedKey = rung === null ? "draft" : canonicalJson(normaliseRung(rung))
  const [draft, setDraft] = useState<RungDraft>(() => (rung === null ? EMPTY_DRAFT : draftOf(rung)))
  const [seeded, setSeeded] = useState(seedKey)
  const [open, setOpen] = useState(kind === "draft")
  const [browseOpen, setBrowseOpen] = useState(false)

  // A stored rung replaced from outside (a move, a prune, an applied edit) is a
  // different rung, so the form is re-read from it. Comparing the *content* is
  // what keeps a re-render from wiping what the user has typed.
  if (seedKey !== seeded) {
    setSeeded(seedKey)
    setDraft(rung === null ? EMPTY_DRAFT : draftOf(rung))
  }

  const own = baseCapture(base)
  const target = draftRung(draft)
  const state = resolve(draft)
  const capture = state.capture
  const verdict = probe?.verdict(capture) ?? null
  const checking = probe?.testing(capture) ?? false
  const failed = verdict !== null && !verdict.ok
  const changes = state.capture === null ? [] : rungChanges(state.capture, own, naming)
  const dirty = target !== null && canonicalJson(normaliseRung(target)) !== seedKey
  const blocked = disabled || target === null || state.problem !== null
  const chosenResolver =
    draft.resolverId === ""
      ? null
      : (catalog.resolvers.find((item) => String(item.id) === draft.resolverId) ?? null)
  const inheritFrom =
    draft.profileId === ""
      ? own
      : (() => {
          const profile = catalog.profiles.find((item) => String(item.id) === draft.profileId)
          if (profile === undefined) return own
          return {
            engine_id: profile.default_engine_id,
            resolver_id: profile.resolver_id,
            resolver_config: profile.resolver_config ?? {},
            profile_id: profile.id,
            profile_name: profile.name,
            retry_mode: profile.retry_mode ?? own.retry_mode,
            retry_config: profile.retry_config ?? {},
          }
        })()

  const label = (text: string): string => `Fallback ${number} · ${text}`
  const prefix = `${idPrefix}-${kind === "draft" ? "fallback" : `rung-${number}`}`
  const fieldId = (name: string): string => `${prefix}-${name}`

  function patch(next: Partial<RungDraft>): void {
    setDraft((current) => ({ ...current, ...next }))
  }

  function apply(): void {
    if (target === null || state.problem !== null || disabled) return
    onApply(normaliseRung(target))
    if (kind === "draft") setDraft(EMPTY_DRAFT)
    else setOpen(false)
  }

  function reset(): void {
    setDraft(rung === null ? EMPTY_DRAFT : draftOf(rung))
  }

  /**
   * A drag starts from the grip, not the card: a draggable ancestor swallows
   * text selection inside the fields, and the card is mostly fields once open.
   * The whole card is still what is dragged.
   */
  function startDrag(event: DragEvent<HTMLElement>): void {
    const card = event.currentTarget.closest("[data-rung]")
    if (card instanceof HTMLElement) event.dataTransfer.setDragImage(card, 16, 16)
    actions?.onDragStart(event)
  }

  return (
    <div
      className={cn(
        "flex flex-col rounded-xs border bg-surface-2 px-2 py-1.5 sm:px-2.5",
        state.problem === null ? "border-line-subtle" : "border-warning bg-warning-dim",
        kind === "draft" && "border-dashed border-[var(--accent-line)]",
        open && state.problem === null && kind === "saved" && "border-line",
        actions?.dragging === true && "opacity-40",
      )}
      data-rung={kind}
      data-problem={state.problem?.kind}
    >
      <div className="flex items-start gap-2">
        {actions === undefined ? null : (
          <span
            draggable={!disabled}
            onDragStart={startDrag}
            onDragEnd={actions.onDragEnd}
            className="mt-1 shrink-0 cursor-grab text-dim active:cursor-grabbing"
            aria-hidden="true"
            title="Drag to reorder"
          >
            <IconGrip size={14} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-expanded={open}
              aria-label={`${open ? "Close" : "Edit"} fallback ${number}`}
              onClick={() => setOpen((current) => !current)}
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded-xs text-left hover:text-ink"
            >
              <IconChevronRight
                size={15}
                className={cn("shrink-0 text-ink-dim transition-transform", open && "rotate-90")}
              />
              <span
                className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-line-strong bg-surface-3 text-2xs font-semibold tabular-nums text-ink-muted"
                aria-hidden="true"
              >
                {number}
              </span>
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                <span className="hidden truncate text-sm text-ink sm:inline">Fallback {number}</span>
                {dirty ? <Tag className="text-dim">edited</Tag> : null}
                {state.problem === null ? null : (
                  <Tag className="border-warning text-warning">problem</Tag>
                )}
                {failed ? (
                  <Tag className="border-danger text-danger">
                    {verdict?.checked_at == null
                      ? "check failed"
                      : `failed ${formatRelativeTime(verdict.checked_at)}`}
                  </Tag>
                ) : null}
              </span>
            </button>

            {actions === undefined ? null : (
              <div className="flex shrink-0 items-center">
                <IconButton
                  label={`Move fallback ${number} up`}
                  size="sm"
                  icon={<IconArrowUp size={13} />}
                  disabled={disabled || !actions.canMoveUp}
                  onClick={actions.onMoveUp}
                />
                <IconButton
                  label={`Move fallback ${number} down`}
                  size="sm"
                  icon={<IconArrowDown size={13} />}
                  disabled={disabled || !actions.canMoveDown}
                  onClick={actions.onMoveDown}
                />
                <IconButton
                  label={`Remove fallback ${number}`}
                  size="sm"
                  icon={<IconX size={13} />}
                  disabled={disabled}
                  onClick={actions.onRemove}
                />
              </div>
            )}
          </div>

          {open ? null : (
            <>
              {changes.length === 0 ? (
                <p className="mt-1 text-xs text-dim">
                  {kind === "draft"
                    ? "Nothing named yet — pick a profile, an engine or a source."
                    : "Changes nothing yet."}
                </p>
              ) : (
                <div
                  role="group"
                  className="mt-1.5 flex flex-wrap items-center gap-1"
                  aria-label={`What fallback ${number} changes`}
                >
                  {changes.map((change) => (
                    <span
                      key={change.key}
                      data-change={change.key}
                      data-change-from={change.from}
                      data-change-to={change.to}
                      className="flex max-w-full shrink-0 items-center gap-1 rounded-xs border border-line-subtle bg-surface-3 px-1.5 py-1 text-xs"
                    >
                      <span className="shrink-0 text-dim">{change.label}</span>
                      {change.from === "" ? null : (
                        <>
                          <span className="max-w-[50%] shrink-0 truncate text-ink-dim">{change.from}</span>
                          <IconArrowRight size={11} className="shrink-0 text-dim" />
                        </>
                      )}
                      <span className="min-w-0 truncate text-ink">{change.to}</span>
                    </span>
                  ))}
                </div>
              )}

              {state.problem === null ? null : (
                <p className="mt-1 text-xs text-warning">
                  {chainProblemSentence(state.problem, subject)}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {open ? (
        <div className="mt-2 flex flex-col gap-2.5 border-t border-line-subtle pt-2">
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Field
              label={label("Profile")}
              htmlFor={fieldId("profile")}
              hint="Optional — takes that profile whole."
            >
              <Select
                id={fieldId("profile")}
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

            <Field label={label("Engine")} htmlFor={fieldId("engine")}>
              <Select
                id={fieldId("engine")}
                value={draft.engineId}
                disabled={disabled}
                onChange={(event) => patch({ engineId: event.target.value })}
              >
                <option value="">Inherit — {naming.engine(inheritFrom.engine_id)}</option>
                {catalog.engines.map((engine) => (
                  <option key={engine.id} value={String(engine.id)}>
                    {engine.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <SourceFields
            key={number}
            idPrefix={prefix}
            formIdPrefix={`${prefix}-${number}`}
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
            kindLabel={`How fallback ${number} takes its source`}
            labels={{ resolver: label("Source"), saved: label("Load a saved source") }}
            inherit={sourceLabel(inheritFrom.resolver_id, inheritFrom.resolver_config, naming)}
            disabled={disabled}
            browse={
              chosenResolver !== null && canBrowseResolver(chosenResolver) ? (
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

          <p
            className="text-sm text-ink-dim"
            data-chain-preview={kind === "draft" ? (target === null ? "empty" : "runs") : undefined}
            data-rung-preview={kind === "saved" ? (target === null ? "empty" : "runs") : undefined}
          >
            {target === null ? (
              kind === "draft" ? (
                "Name a profile, an engine or a source to add a fallback."
              ) : (
                "Name a profile, an engine or a source to keep this fallback."
              )
            ) : state.capture === null ? (
              <span className="text-warning">That names something no longer here.</span>
            ) : (
              <>
                Runs <span className="text-ink">{captureLabel(state.capture, base, naming)}</span>
              </>
            )}
          </p>

          {verdict === null ? null : (
            <p className="text-xs" data-probe={verdict.ok ? "ok" : "failed"}>
              {verdict.ok ? (
                <span className="text-ink-dim">
                  {verdict.checked_at == null ? "The stream answers" : `Checked ${formatRelativeTime(verdict.checked_at)}`}{" "}
                  · answered in {(verdict.latency_ms / 1000).toFixed(1)} s
                </span>
              ) : (
                <span className="text-danger">{verdict.error ?? "The last check failed."}</span>
              )}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="primary"
              disabled={blocked}
              aria-label={kind === "draft" ? undefined : `Apply fallback ${number}`}
              onClick={apply}
            >
              {kind === "draft" ? "Add fallback" : "Apply"}
            </Button>
            {probe === undefined ? null : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={capture === null || checking || disabled}
                aria-label={
                  checking
                    ? `Checking fallback ${number}`
                    : verdict === null
                      ? `Check fallback ${number}`
                      : `Check fallback ${number} again`
                }
                onClick={() => {
                  if (capture !== null) probe.test(capture)
                }}
              >
                {checking ? "Checking…" : verdict === null ? "Check this source" : "Check again"}
              </Button>
            )}
            {kind === "saved" && dirty ? (
              <Button type="button" size="sm" variant="outline" onClick={reset}>
                Reset
              </Button>
            ) : null}
            {state.problem === null ? null : (
              <span className="text-xs text-dim">{chainProblemSentence(state.problem, subject)}</span>
            )}
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
    </div>
  )
}
