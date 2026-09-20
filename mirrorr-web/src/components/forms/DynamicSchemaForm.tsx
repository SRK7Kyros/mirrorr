/**
 * DynamicSchemaForm — renders a resolver `config_schema` or an engine retry
 * mode's `schema` (spec L403). Supported kinds: string → text, number/integer
 * → number input (min/max), boolean → switch, enum → select, array of
 * integers → comma-separated tag input, nested object → collapsible group,
 * key/value rows for `additionalProperties` objects.
 *
 * The component is controlled: the caller owns `values` (defaults already
 * merged) and receives the next object on every edit. Errors are looked up by
 * dotted path so a server 422 `loc` of `resolver_config.url` lands inline.
 */
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Select } from "@/components/ui/Select"
import { Switch } from "@/components/ui/Switch"
import {
  fieldLabel,
  formatIntegerListText,
  isPlainObject,
  parseIntegerListText,
  schemaProperties,
  schemaWantsKeyValues,
  unknownPropertyKeys,
} from "@/lib/schema-form"
import { isObjectSchema, readJsonSchema, type JsonSchema } from "@/lib/schemas/json-schema"

export interface DynamicSchemaFormProps {
  readonly schema: JsonSchema | undefined
  readonly values: Record<string, unknown>
  readonly onChange: (next: Record<string, unknown>) => void
  readonly errors?: Readonly<Record<string, string>>
  /** Dotted prefix for error lookups, e.g. `resolver_config`. */
  readonly path?: string
  readonly idPrefix: string
}

function errorFor(errors: Readonly<Record<string, string>>, path: string, key: string): string | undefined {
  return errors[path.length > 0 ? `${path}.${key}` : key]
}

function displayValue(value: unknown): string {
  if (value === undefined || value === null) return ""
  if (typeof value === "string") return value
  return String(value)
}

/** Declared keys survive untouched; the free-form rows replace the rest. */
function replaceUnknownKeys(
  schema: JsonSchema,
  values: Record<string, unknown>,
  nextUnknown: Record<string, unknown>,
): Record<string, unknown> {
  const declared = new Set(Object.keys(schema.properties ?? {}))
  const kept = Object.fromEntries(Object.entries(values).filter(([key]) => declared.has(key)))
  return { ...kept, ...nextUnknown }
}

export function DynamicSchemaForm({ schema, values, onChange, errors = {}, path = "", idPrefix }: DynamicSchemaFormProps) {
  if (schema === undefined) return null

  const properties = schemaProperties(schema)
  const keyValues = schemaWantsKeyValues(schema) && properties.length === 0
  const unknownKeys = properties.length > 0 ? unknownPropertyKeys(schema, values) : []
  if (properties.length === 0 && !keyValues) return null

  return (
    <div className="flex flex-col gap-3" data-testid={`${idPrefix}-schema-form`}>
      {properties.map(([key, child]) => (
        <SchemaField
          key={key}
          name={key}
          schema={child}
          value={values[key]}
          required={schema.required?.includes(key) ?? false}
          error={errorFor(errors, path, key)}
          allErrors={errors}
          path={path}
          idPrefix={idPrefix}
          onChange={(next) => onChange({ ...values, [key]: next })}
        />
      ))}
      {keyValues ? (
        <KeyValueRows
          label={schema.title ?? "Fields"}
          values={values}
          error={errors[path]}
          idPrefix={idPrefix}
          onChange={onChange}
        />
      ) : null}
      {unknownKeys.length > 0 ? (
        <KeyValueRows
          label="Additional fields"
          values={Object.fromEntries(unknownKeys.map((key) => [key, values[key]]))}
          error={errors[path]}
          idPrefix={`${idPrefix}-additional`}
          onChange={(next) => onChange(replaceUnknownKeys(schema, values, next))}
        />
      ) : null}
    </div>
  )
}

interface SchemaFieldProps {
  readonly name: string
  readonly schema: JsonSchema
  readonly value: unknown
  readonly required: boolean
  readonly error: string | undefined
  readonly allErrors: Readonly<Record<string, string>>
  readonly path: string
  readonly idPrefix: string
  readonly onChange: (next: unknown) => void
}

function SchemaField({ name, schema, value, required, error, allErrors, path, idPrefix, onChange }: SchemaFieldProps) {
  const marker = required ? " *" : ""
  const label = `${fieldLabel(schema, name)}${marker}`
  const fieldId = `${idPrefix}-${name}`
  const childPath = path.length > 0 ? `${path}.${name}` : name

  if (schema.type === "boolean") {
    return <Switch label={label} checked={value === true} onCheckedChange={onChange} />
  }

  if (schema.enum !== undefined && schema.enum.length > 0) {
    return (
      <Select
        label={label}
        id={fieldId}
        error={error}
        value={displayValue(value)}
        onChange={(event) => onChange(event.target.value.length > 0 ? event.target.value : undefined)}
      >
        <option value="">Select…</option>
        {schema.enum.map((option) => (
          <option key={String(option)} value={String(option)}>
            {String(option)}
          </option>
        ))}
      </Select>
    )
  }

  if (schema.type === "number" || schema.type === "integer") {
    return (
      <Input
        label={label}
        id={fieldId}
        error={error}
        type="number"
        min={schema.minimum}
        max={schema.maximum}
        step={schema.type === "integer" ? 1 : "any"}
        value={typeof value === "number" ? String(value) : ""}
        onChange={(event) => {
          const text = event.target.value
          onChange(text.length === 0 ? undefined : Number(text))
        }}
      />
    )
  }

  if (schema.type === "array") {
    const items = readJsonSchema(schema.items)
    if (items.type === "integer" || items.type === "number") {
      return (
        <Input
          label={label}
          id={fieldId}
          error={error}
          value={formatIntegerListText(value)}
          placeholder="1, 2, 3"
          onChange={(event) => onChange(parseIntegerListText(event.target.value))}
        />
      )
    }
  }

  if (isObjectSchema(schema)) {
    const nested = isPlainObject(value) ? value : {}
    if (schema.properties !== undefined) {
      return (
        <details className="rounded-control border border-border px-3 py-2">
          <summary className="cursor-pointer text-label text-text-secondary">{label}</summary>
          <div className="pt-3">
            <DynamicSchemaForm
              schema={schema}
              values={nested}
              errors={allErrors}
              path={childPath}
              idPrefix={`${idPrefix}-${name}`}
              onChange={onChange}
            />
          </div>
        </details>
      )
    }
    return (
      <KeyValueRows
        label={label}
        values={nested}
        error={error}
        idPrefix={`${idPrefix}-${name}`}
        onChange={onChange}
      />
    )
  }

  return (
    <Input
      label={label}
      id={fieldId}
      error={error}
      value={displayValue(value)}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

interface KeyValueRowsProps {
  readonly label: string
  readonly values: Record<string, unknown>
  readonly error: string | undefined
  readonly idPrefix: string
  readonly onChange: (next: Record<string, unknown>) => void
}

function KeyValueRows({ label, values, error, idPrefix, onChange }: KeyValueRowsProps) {
  const entries = Object.entries(values)

  function rename(oldKey: string, newKey: string) {
    const next: Record<string, unknown> = {}
    for (const [key, value] of entries) next[key === oldKey ? newKey : key] = value
    onChange(next)
  }

  function setValue(key: string, value: string) {
    onChange({ ...values, [key]: value })
  }

  function remove(key: string) {
    const next: Record<string, unknown> = {}
    for (const [entryKey, value] of entries) {
      if (entryKey !== key) next[entryKey] = value
    }
    onChange(next)
  }

  function add() {
    let index = entries.length + 1
    let key = `key${index}`
    while (key in values) {
      index += 1
      key = `key${index}`
    }
    onChange({ ...values, [key]: "" })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-label text-text-secondary">{label}</span>
        <Button size="sm" variant="ghost" icon={Plus} onClick={add}>
          Add
        </Button>
      </div>
      {entries.length === 0 ? <p className="text-small text-text-muted">None</p> : null}
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-end gap-2">
          <Input
            label="Key"
            id={`${idPrefix}-${key}-key`}
            value={key}
            onChange={(event) => rename(key, event.target.value)}
          />
          <Input
            label="Value"
            id={`${idPrefix}-${key}-value`}
            value={displayValue(value)}
            onChange={(event) => setValue(key, event.target.value)}
          />
          <Button
            variant="ghost"
            icon={Trash2}
            aria-label={`Remove ${key}`}
            title={`Remove ${key}`}
            onClick={() => remove(key)}
          />
        </div>
      ))}
      {error !== undefined ? <p className="text-small text-danger">{error}</p> : null}
    </div>
  )
}
