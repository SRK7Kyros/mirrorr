import { useMemo, useState } from "react"
import { useSources } from "@/api"
import {
  captureLabel,
  catalogNaming,
  chainProblemSentence,
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
  IconButton,
  IconSearch,
  IconX,
  SchemaForm,
  Select,
  Tag,
  defaultsFromSchema,
  panelTitleClass,
} from "@/ui/components"
import { DiscoveryDrawer, canBrowseResolver } from "./discovery-drawer"

interface RungDraft {
  readonly profileId: string
  readonly engineId: string
  readonly resolverId: string
  readonly resolverConfig: Record<string, unknown>
}

const EMPTY_DRAFT: RungDraft = { profileId: "", engineId: "", resolverId: "", resolverConfig: {} }

function move(list: readonly FallbackRung[], from: number, to: number): FallbackRung[] {
  if (to < 0 || to >= list.length) return [...list]
  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

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

/** What a rung inherits when it names nothing — the profile's, else the rung above's. */
function inherited(
  profileId: string,
  previous: ChainCapture,
  catalog: ChainCatalog,
): { capture: ChainCapture; profile: ChainCatalog["profiles"][number] | null } {
  const profile =
    profileId === "" ? null : (catalog.profiles.find((item) => item.id === Number(profileId)) ?? null)
  if (profile === null) return { capture: previous, profile }
  return {
    profile,
    capture: {
      engine_id: profile.default_engine_id,
      resolver_id: profile.resolver_id,
      resolver_config: profile.resolver_config ?? {},
      profile_id: profile.id,
      profile_name: profile.name,
      retry_mode: profile.retry_mode ?? previous.retry_mode,
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
 * The chain tried after a capture, built one rung at a time.
 *
 * A rung is a *patch*, not a kind of thing: it may name a profile, a different
 * engine, a different source, or any combination, and whatever it leaves blank
 * is inherited from the rung above. The bottom editor is always the rung being
 * written, and it shows what that rung will actually run before it is added.
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
  const naming = useMemo(() => catalogNaming({ ...catalog, sources }), [catalog, sources])
  const resolved = useMemo(() => resolveChain(value, base, catalog), [value, base, catalog])
  const rung = draftRung(draft)
  const preview = rung === null ? null : resolveRung(rung, resolved.last, catalog)
  const candidate = useMemo(
    () => (rung === null ? null : resolveChain([...value, rung], base, catalog)),
    [rung, value, base, catalog],
  )
  const blocker =
    candidate !== null && candidate.problem !== null && candidate.problem.index === value.length
      ? candidate.problem
      : null
  const inheritedNow = inherited(draft.profileId, resolved.last, catalog)
  const chosenResolver =
    draft.resolverId === "" ? null : (catalog.resolvers.find((item) => String(item.id) === draft.resolverId) ?? null)
  const canBrowse = canBrowseResolver(chosenResolver)
  const step = value.length + 1
  const label = (text: string): string => `Fallback ${step} · ${text}`

  function patch(next: Partial<RungDraft>): void {
    setDraft((previous) => ({ ...previous, ...next }))
  }

  function commit(): void {
    if (rung === null || blocker !== null || disabled) return
    onChange([...value, normaliseRung(rung)])
    setDraft(EMPTY_DRAFT)
  }

  return (
    <section className="flex flex-col gap-2">
      <h3 className={panelTitleClass}>Fallbacks</h3>
      <p className="text-sm text-ink-dim">
        Tried in this order after its own capture. A rung changes only what it names — anything left
        blank is inherited from the rung above.
      </p>

      {value.length > 0 ? (
        <ol className="flex flex-wrap gap-2" aria-label="Fallback chain, in order">
          {resolved.steps.map((entry, index) => {
            const name = rungLabel(entry.rung, naming)
            const runs = entry.capture === null ? null : captureLabel(entry.capture, base, naming)
            return (
              <li
                key={index}
                data-problem={entry.problem?.kind}
                title={runs === null ? undefined : `Runs ${runs}`}
                className={`flex h-9 items-center gap-1 rounded-xs border pl-1.5 pr-1 ${
                  entry.problem === null ? "border-line-subtle bg-surface-2" : "border-warning bg-warning-dim"
                }`}
              >
                <Tag className="border-0 bg-transparent px-0 text-ink-dim">{index + 1}</Tag>
                <span
                  className={`max-w-52 truncate text-sm ${entry.problem === null ? "text-ink" : "text-warning"}`}
                >
                  {name}
                </span>
                <IconButton
                  label={`Move fallback ${index + 1} up`}
                  size="sm"
                  icon={<IconArrowUp size={13} />}
                  disabled={disabled || index === 0}
                  onClick={() => onChange(move(value, index, index - 1))}
                />
                <IconButton
                  label={`Move fallback ${index + 1} down`}
                  size="sm"
                  icon={<IconArrowDown size={13} />}
                  disabled={disabled || index === value.length - 1}
                  onClick={() => onChange(move(value, index, index + 1))}
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
      ) : null}

      {resolved.problem === null ? null : (
        <p
          role="status"
          data-chain-problem={resolved.problem.kind}
          className="text-sm text-warning"
        >
          {chainProblemSentence(resolved.problem, subject)}
        </p>
      )}

      <div className="flex flex-col gap-3 rounded-xs border border-line-subtle bg-surface-2 p-3">
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

        <Field
          label={label("Source")}
          htmlFor={`${idPrefix}-fallback-resolver`}
          hint={
            inheritedNow.profile === null
              ? undefined
              : `Leave blank to run ${inheritedNow.profile.name}'s own source.`
          }
        >
          <Select
            id={`${idPrefix}-fallback-resolver`}
            value={draft.resolverId}
            disabled={disabled}
            onChange={(event) => {
              const next = catalog.resolvers.find((item) => String(item.id) === event.target.value)
              patch({
                resolverId: event.target.value,
                resolverConfig: defaultsFromSchema(next?.config_schema),
              })
            }}
          >
            <option value="">
              Inherit —{" "}
              {sourceLabel(
                inheritedNow.capture.resolver_id,
                inheritedNow.capture.resolver_config,
                naming,
              )}
            </option>
            {catalog.resolvers.map((resolver) => (
              <option key={resolver.id} value={String(resolver.id)}>
                {resolver.name}
              </option>
            ))}
          </Select>
        </Field>

        {sources.length > 0 ? (
          <Field
            label={label("Load a saved source")}
            htmlFor={`${idPrefix}-fallback-source`}
            hint="Fills the source and its config."
          >
            <Select
              id={`${idPrefix}-fallback-source`}
              value=""
              disabled={disabled}
              onChange={(event) => {
                const next = sources.find((source) => String(source.id) === event.target.value)
                if (next === undefined) return
                patch({
                  resolverId: String(next.resolver_id),
                  resolverConfig: next.resolver_config ?? {},
                })
              }}
            >
              <option value="">Pick a saved source…</option>
              {sources.map((source) => (
                <option key={source.id} value={String(source.id)}>
                  {source.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {chosenResolver === null ? null : (
          <section className="flex flex-col gap-2">
            {canBrowse ? (
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
            ) : null}
            <h3 className={panelTitleClass}>Resolver config</h3>
            <SchemaForm
              schema={chosenResolver.config_schema}
              value={draft.resolverConfig}
              onChange={(next) => patch({ resolverConfig: next })}
              idPrefix={`${idPrefix}-fallback-${step}`}
            />
          </section>
        )}

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
