import { useId, useState } from "react"
import { useSources } from "@/api"
import {
  fallbackSourceLabel,
  sourceKey,
  type FallbackSource,
} from "@/api/domain/fallback-sources"
import type { Resolver } from "@/api/schemas"
import {
  Button,
  Field,
  IconArrowDown,
  IconArrowUp,
  IconButton,
  IconX,
  SchemaForm,
  Select,
  Tag,
  defaultsFromSchema,
} from "@/ui/components"

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
  readonly disabled?: boolean
}

/**
 * Ordered chain of resolver + config sources to try after the subject's own
 * capture fails, for a run that names an engine and a resolver rather than a
 * profile. Rungs are added either as a saved source (a name and a config
 * already stored) or by picking a resolver and filling its config — both are
 * the same thing to the server, so the choice is only about how much typing.
 *
 * The capture's own resolver may appear again with a different config; an
 * identical resolver + config never appears twice.
 */
export function FallbackSources({
  resolvers,
  value,
  onChange,
  disabled = false,
}: FallbackSourcesProps) {
  const selectId = useId()
  const sources = useSources()
  const [addingResolverId, setAddingResolverId] = useState("")
  const [draftConfig, setDraftConfig] = useState<Record<string, unknown>>({})

  const taken = new Set(value.map(sourceKey))
  const availableSources = sources.filter(
    (source) =>
      !taken.has(
        sourceKey({
          resolver_id: source.resolver_id,
          resolver_config: source.resolver_config ?? {},
        }),
      ),
  )
  const draftResolver = resolvers.find((item) => String(item.id) === addingResolverId)
  const draftKey =
    draftResolver === undefined
      ? ""
      : sourceKey({ resolver_id: draftResolver.id, resolver_config: draftConfig })

  function startResolver(id: string): void {
    const resolver = resolvers.find((item) => String(item.id) === id)
    setAddingResolverId(id)
    setDraftConfig(defaultsFromSchema(resolver?.config_schema))
  }

  function addResolver(): void {
    if (draftResolver === undefined || taken.has(draftKey)) return
    onChange([
      ...value,
      { resolver_id: draftResolver.id, resolver_config: draftConfig },
    ])
    setAddingResolverId("")
    setDraftConfig({})
  }

  const resolverName = (id: number): string =>
    resolvers.find((item) => item.id === id)?.name ?? `Resolver ${id}`

  return (
    <Field
      label="Fallback sources"
      htmlFor={selectId}
      hint={
        value.length === 0
          ? "None — the session fails if its own capture does."
          : "Tried in this order, after its own capture, on this engine."
      }
    >
      <div className="flex flex-col gap-2">
        {value.length > 0 ? (
          <ol className="flex flex-wrap gap-2" aria-label="Fallback sources, in order">
            {value.map((entry, index) => {
              const name = fallbackSourceLabel(entry, resolverName, sources)
              return (
                <li
                  key={sourceKey(entry)}
                  className="flex h-9 items-center gap-1 rounded-xs border border-line-subtle bg-surface-2 pl-1.5 pr-1"
                >
                  <Tag className="border-0 bg-transparent px-0 text-ink-dim">{index + 1}</Tag>
                  <span className="max-w-52 truncate text-sm text-ink">{name}</span>
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
                    onClick={() =>
                      onChange(value.filter((_, position) => position !== index))
                    }
                  />
                </li>
              )
            })}
          </ol>
        ) : null}

        <Select
          id={selectId}
          value={addingResolverId === "" ? "" : `resolver:${addingResolverId}`}
          disabled={disabled}
          aria-label="Add a fallback source"
          onChange={(event) => {
            const picked = event.target.value
            if (picked === "") {
              setAddingResolverId("")
              setDraftConfig({})
              return
            }
            if (picked.startsWith("source:")) {
              const source = sources.find(
                (item) => String(item.id) === picked.slice("source:".length),
              )
              if (source === undefined) return
              onChange([
                ...value,
                {
                  resolver_id: source.resolver_id,
                  resolver_config: source.resolver_config ?? {},
                },
              ])
              return
            }
            startResolver(picked.slice("resolver:".length))
          }}
        >
          <option value="">Add a fallback source…</option>
          {availableSources.length > 0 ? (
            <optgroup label="Saved sources">
              {availableSources.map((source) => (
                <option key={source.id} value={`source:${source.id}`}>
                  {source.name} — {resolverName(source.resolver_id)}
                </option>
              ))}
            </optgroup>
          ) : null}
          <optgroup label="Resolver + config">
            {resolvers.map((resolver) => (
              <option key={resolver.id} value={`resolver:${resolver.id}`}>
                {resolver.name}
              </option>
            ))}
          </optgroup>
        </Select>

        {draftResolver === undefined ? null : (
          <div className="flex flex-col gap-2 rounded-xs border border-line-subtle bg-surface-2 p-3">
            <p className="text-sm text-ink">
              Fallback source · {draftResolver.name}
            </p>
            <SchemaForm
              schema={draftResolver.config_schema}
              value={draftConfig}
              onChange={setDraftConfig}
              idPrefix={`fallback-source-${draftResolver.id}`}
            />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="primary"
                disabled={disabled || taken.has(draftKey)}
                onClick={addResolver}
              >
                Add fallback
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => {
                  setAddingResolverId("")
                  setDraftConfig({})
                }}
              >
                Cancel
              </Button>
              {taken.has(draftKey) ? (
                <span className="text-xs text-dim">Already in the chain.</span>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </Field>
  )
}
