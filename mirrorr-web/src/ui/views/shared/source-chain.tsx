import { useState, type ReactNode } from "react"
import { useSources } from "@/api"
import { canonicalJson, type FallbackSource } from "@/api/domain/fallback-sources"
import type { Resolver } from "@/api/schemas"
import {
  Field,
  SchemaForm,
  Segmented,
  Select,
  defaultsFromSchema,
  panelTitleClass,
} from "@/ui/components"

/** How one capture's source is filled: a resolver and its config, or a saved source. */
export type SourceKind = "resolver" | "source"

/** One capture's source while the form holds it — the resolver may still be unset. */
export interface SourceDraft {
  readonly resolverId: number | null
  readonly resolverConfig: Record<string, unknown>
}

function entryKey(entry: FallbackSource): string {
  return `${entry.resolver_id}:${canonicalJson(entry.resolver_config ?? {})}`
}

function draftKey(draft: SourceDraft): string {
  if (draft.resolverId === null) return ""
  return `${draft.resolverId}:${canonicalJson(draft.resolverConfig)}`
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
  /**
   * What a blank resolver means, when it means anything. A fallback rung leaves
   * its base's source alone; a run's own capture has nothing to leave alone, so
   * omitting this makes the resolver required.
   */
  readonly inherit?: string
  /** Ids for the config form when they must not follow the control ids (per-rung). */
  readonly formIdPrefix?: string
  /** Field labels when a caller numbers its rows — `Fallback 2 · Source`. */
  readonly labels?: { readonly resolver?: string; readonly saved?: string }
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
  inherit,
  formIdPrefix,
  labels,
  disabled = false,
}: SourceFieldsProps) {
  const [kind, setKind] = useState<SourceKind>("resolver")
  const sources = useSources()
  const resolver = resolvers.find((item) => item.id === value.resolverId)
  const currentKey = draftKey(value)
  const picked = sources.find((source) => entryKey(source) === currentKey)
  // A face with nothing behind it is not offered: a disabled tab answers a tap
  // with silence, so the reason is said instead.
  const canPick = sources.length > 0
  const face: SourceKind = canPick ? kind : "resolver"
  const inherited = inherit !== undefined

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
          No saved source to load — fill a resolver and its config.
        </p>
      )}

      {face === "resolver" ? (
        <>
          <Field
            label={labels?.resolver ?? `${labelPrefix}Resolver`}
            htmlFor={`${idPrefix}-resolver`}
            required={!inherited}
          >
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
              <option value="">
                {inherited ? `Inherit — ${inherit}` : "Select a resolver…"}
              </option>
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
              <p className="text-sm text-ink-dim">
                {inherited
                  ? `Leaves the source as it is — ${inherit}.`
                  : "Pick a resolver to configure it."}
              </p>
            ) : (
              <SchemaForm
                schema={resolver.config_schema}
                value={value.resolverConfig}
                onChange={(next) => onChange({ resolverId: resolver.id, resolverConfig: next })}
                idPrefix={formIdPrefix ?? idPrefix}
              />
            )}
          </section>
        </>
      ) : (
        <Field
          label={labels?.saved ?? `${labelPrefix}Saved source`}
          htmlFor={`${idPrefix}-source`}
          hint={canPick ? "Fills the resolver and its config." : "No saved sources to pick."}
        >
          <Select
            id={`${idPrefix}-source`}
            value={picked === undefined ? "" : String(picked.id)}
            disabled={disabled}
            onChange={(event) => {
              const next = sources.find((source) => String(source.id) === event.target.value)
              if (next === undefined) return
              onChange(saveAsDraft(next))
            }}
          >
            <option value="">Pick a saved source…</option>
            {sources.map((source) => (
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
