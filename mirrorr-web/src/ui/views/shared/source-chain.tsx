import { useState, type ReactNode } from "react"
import { useSources } from "@/api"
import { chainProblem, chainProblemSentence, fallbackSourceLabel, sourceKey, type FallbackSource } from "@/api/domain/fallback-sources"
import type { Resolver } from "@/api/schemas"
import {
  Button,
  Field,
  IconArrowDown,
  IconArrowUp,
  IconButton,
  IconSearch,
  IconX,
  SchemaForm,
  Segmented,
  Select,
  Tag,
  defaultsFromSchema,
  panelTitleClass,
} from "@/ui/components"
import { DiscoveryDrawer, canBrowseResolver } from "./discovery-drawer"

/** How one capture's source is filled: a resolver and its config, or a saved source. */
export type SourceKind = "resolver" | "source"

/** One capture's source while the form holds it — the resolver may still be unset. */
export interface SourceDraft {
  readonly resolverId: number | null
  readonly resolverConfig: Record<string, unknown>
}

const EMPTY_DRAFT: SourceDraft = { resolverId: null, resolverConfig: {} }

function entryKey(entry: FallbackSource): string {
  return sourceKey({ resolver_id: entry.resolver_id, resolver_config: entry.resolver_config ?? {} })
}

function draftKey(draft: SourceDraft): string {
  if (draft.resolverId === null) return ""
  return sourceKey({ resolver_id: draft.resolverId, resolver_config: draft.resolverConfig })
}

function saveAsDraft(entry: FallbackSource): SourceDraft {
  return { resolverId: entry.resolver_id, resolverConfig: entry.resolver_config ?? {} }
}

function resolverName(resolvers: readonly Resolver[], id: number): string {
  return resolvers.find((item) => item.id === id)?.name ?? `Resolver ${id}`
}

export interface SourceFieldsProps {
  readonly idPrefix: string
  readonly resolvers: readonly Resolver[]
  readonly value: SourceDraft
  readonly onChange: (next: SourceDraft) => void
  /** Accessible name of the kind switch, which is one control among several rows. */
  readonly kindLabel: string
  /** Prefix on the two field labels, so a chain's rows stay distinguishable. */
  readonly labelPrefix?: string
  /** Extra control beside the resolver select (a resolver's own catalog browser). */
  readonly browse?: ReactNode
  /** Rungs that must not be offered again — the chain already holds them. */
  readonly exclude?: readonly FallbackSource[]
  readonly disabled?: boolean
}

/**
 * One capture's source, filled either way round: pick a resolver and its config
 * here, or load a saved source and let it fill both. The two are the same thing
 * to the server, so they are one control with two faces rather than two fields
 * that would disagree — switching faces keeps whatever is already filled.
 */
export function SourceFields({
  idPrefix,
  resolvers,
  value,
  onChange,
  kindLabel,
  labelPrefix = "",
  browse,
  exclude,
  disabled = false,
}: SourceFieldsProps) {
  const [kind, setKind] = useState<SourceKind>("resolver")
  const sources = useSources()
  const taken = new Set((exclude ?? []).map(entryKey))
  const offered = sources.filter((source) => !taken.has(entryKey(source)))
  const resolver = resolvers.find((item) => item.id === value.resolverId)
  const currentKey = draftKey(value)
  const picked = offered.find((source) => entryKey(source) === currentKey)
  // A face with nothing behind it is not offered: a disabled tab answers a tap
  // with silence, so the reason is said instead.
  const canPick = offered.length > 0
  const face: SourceKind = canPick ? kind : "resolver"

  return (
    <div className="flex flex-col gap-3">
      {canPick ? (
        <Segmented
          ariaLabel={kindLabel}
          active={face}
          onChange={setKind}
          items={[
            { id: "resolver", label: "Resolver + config", disabled },
            { id: "source", label: "Saved source", disabled },
          ]}
        />
      ) : (
        <p className="text-sm text-ink-dim">
          {sources.length === 0
            ? "No saved source to load — fill a resolver and its config."
            : "Every saved source is already in this chain — fill a resolver and its config."}
        </p>
      )}

      {face === "resolver" ? (
        <>
          <Field label={`${labelPrefix}Resolver`} htmlFor={`${idPrefix}-resolver`} required>
            <Select
              id={`${idPrefix}-resolver`}
              value={value.resolverId === null ? "" : String(value.resolverId)}
              disabled={disabled}
              onChange={(event) => {
                const next = resolvers.find((item) => String(item.id) === event.target.value)
                onChange({
                  resolverId: next?.id ?? null,
                  resolverConfig: defaultsFromSchema(next?.config_schema),
                })
              }}
            >
              <option value="">Select a resolver…</option>
              {resolvers.map((item) => (
                <option key={item.id} value={String(item.id)}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Field>

          {browse}

          <section className="flex flex-col gap-2">
            <h3 className={panelTitleClass}>Resolver config</h3>
            {resolver === undefined ? (
              <p className="text-sm text-ink-dim">Pick a resolver to configure it.</p>
            ) : (
              <SchemaForm
                schema={resolver.config_schema}
                value={value.resolverConfig}
                onChange={(next) => onChange({ resolverId: resolver.id, resolverConfig: next })}
                idPrefix={idPrefix}
              />
            )}
          </section>
        </>
      ) : (
        <Field
          label={`${labelPrefix}Saved source`}
          htmlFor={`${idPrefix}-source`}
          hint={offered.length === 0 ? "No saved sources left to pick." : "Fills the resolver and its config."}
        >
          <Select
            id={`${idPrefix}-source`}
            value={picked === undefined ? "" : String(picked.id)}
            disabled={disabled}
            onChange={(event) => {
              const next = offered.find((source) => String(source.id) === event.target.value)
              if (next === undefined) return
              onChange(saveAsDraft(next))
            }}
          >
            <option value="">Pick a saved source…</option>
            {offered.map((source) => (
              <option key={source.id} value={String(source.id)}>
                {source.name} — {resolverName(resolvers, source.resolver_id)}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </div>
  )
}

function move(list: readonly FallbackSource[], from: number, to: number): FallbackSource[] {
  if (to < 0 || to >= list.length) return [...list]
  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

export interface FallbackSourcesProps {
  readonly resolvers: readonly Resolver[]
  /** Rungs in the order they are tried. */
  readonly value: readonly FallbackSource[]
  readonly onChange: (next: FallbackSource[]) => void
  /** The run's own capture — offered again only with a different config. */
  readonly primary?: FallbackSource | null
  readonly disabled?: boolean
  /** Who owns the capture before the chain — it decides how a clash is worded. */
  readonly subject?: "run" | "profile"
}

/**
 * The chain after a run's own capture, for a run that names an engine and a
 * resolver rather than a profile. It is built one rung at a time: the next rung
 * is always the one editor at the bottom, and completing it adds the rung and
 * opens the following one. Each rung can be filled as a saved source or as a
 * resolver plus its config — the same two ways as the run's own source.
 *
 * The capture's own resolver may appear again with a different config; an
 * identical resolver + config never appears twice.
 */
export function FallbackSources({
  resolvers,
  value,
  onChange,
  primary = null,
  disabled = false,
  subject = "run",
}: FallbackSourcesProps) {
  const sources = useSources()
  const [draft, setDraft] = useState<SourceDraft>(EMPTY_DRAFT)
  const [browseOpen, setBrowseOpen] = useState(false)
  const draftResolver = resolvers.find((item) => item.id === draft.resolverId) ?? null
  const browser = canBrowseResolver(draftResolver) ? draftResolver : null

  const taken = new Set(value.map(entryKey))
  const key = draftKey(draft)
  const isPrimary = key !== "" && primary !== null && key === entryKey(primary)
  const duplicate = key !== "" && taken.has(key)
  const step = value.length + 1
  const excluded = primary === null ? [...value] : [...value, primary]
  const problem = chainProblem(value, primary)

  function commit(): void {
    if (draft.resolverId === null || duplicate || isPrimary || disabled) return
    onChange([
      ...value,
      { resolver_id: draft.resolverId, resolver_config: draft.resolverConfig },
    ])
    setDraft(EMPTY_DRAFT)
  }

  return (
    <section className="flex flex-col gap-2">
      <h3 className={panelTitleClass}>Fallbacks</h3>
      <p className="text-sm text-ink-dim">
        Tried in this order after its own capture, on this engine. Each rung opens the next.
      </p>

      {value.length > 0 ? (
        <ol className="flex flex-wrap gap-2" aria-label="Fallback sources, in order">
          {value.map((entry, index) => {
            const name = fallbackSourceLabel(entry, (id) => resolverName(resolvers, id), sources)
            const offender = problem !== null && problem.index === index
            return (
              <li
                key={entryKey(entry)}
                data-problem={offender ? problem.kind : undefined}
                className={`flex h-9 items-center gap-1 rounded-xs border pl-1.5 pr-1 ${
                  offender
                    ? "border-warning bg-warning-dim"
                    : "border-line-subtle bg-surface-2"
                }`}
              >
                <Tag className="border-0 bg-transparent px-0 text-ink-dim">{index + 1}</Tag>
                <span
                  className={`max-w-52 truncate text-sm ${offender ? "text-warning" : "text-ink"}`}
                >
                  {name}
                </span>
                <IconButton
                  label={`Move ${name} up`}
                  size="sm"
                  icon={<IconArrowUp size={13} />}
                  disabled={disabled || index === 0}
                  onClick={() => onChange(move(value, index, index - 1))}
                />
                <IconButton
                  label={`Move ${name} down`}
                  size="sm"
                  icon={<IconArrowDown size={13} />}
                  disabled={disabled || index === value.length - 1}
                  onClick={() => onChange(move(value, index, index + 1))}
                />
                <IconButton
                  label={`Remove ${name}`}
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

      {problem === null ? null : (
        <p role="status" data-chain-problem={problem.kind} className="text-sm text-warning">
          {chainProblemSentence(problem, subject)}
        </p>
      )}

      <div className="flex flex-col gap-3 rounded-xs border border-line-subtle bg-surface-2 p-3">
        <p className="text-sm text-ink">Fallback {step}</p>
        <SourceFields
          idPrefix={`fallback-source-${step}`}
          kindLabel={`Fallback ${step} source`}
          labelPrefix={`Fallback ${step} · `}
          resolvers={resolvers}
          value={draft}
          onChange={setDraft}
          exclude={excluded}
          disabled={disabled}
          browse={
            browser !== null ? (
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  icon={<IconSearch size={15} />}
                  disabled={disabled}
                  onClick={() => setBrowseOpen(true)}
                >
                  Browse {browser.name}…
                </Button>
              </div>
            ) : undefined
          }
        />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="primary"
            disabled={disabled || draft.resolverId === null || duplicate || isPrimary}
            onClick={commit}
          >
            Add fallback
          </Button>
          {isPrimary ? (
            <span className="text-xs text-dim">Same as the run&rsquo;s own source.</span>
          ) : duplicate ? (
            <span className="text-xs text-dim">Already in the chain.</span>
          ) : null}
        </div>
      </div>

      {browser !== null ? (
        <DiscoveryDrawer
          open={browseOpen}
          onClose={() => setBrowseOpen(false)}
          resolver={browser}
          onUse={(item) => {
            setDraft({ resolverId: browser.id, resolverConfig: item.config ?? {} })
            setBrowseOpen(false)
          }}
        />
      ) : null}
    </section>
  )
}
