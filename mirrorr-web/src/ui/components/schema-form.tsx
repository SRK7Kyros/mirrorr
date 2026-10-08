import { useState } from "react"
import { humanize } from "@/ui/lib/format"
import { Field } from "./Field"
import { Input } from "./Input"
import { Select } from "./Select"
import { Switch } from "./Switch"
import { Textarea } from "./Textarea"

/**
 * JSON-Schema-driven form. Resolver `config_schema` / `search_schema` and
 * engine `retry_modes_schema` are plain JSON Schemas, so no plugin-specific
 * field is hardcoded — the form is built from whatever the plugin declares.
 */

export type JsonSchema = Record<string, unknown>

export function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function schemaProperties(schema: JsonSchema | undefined): Record<string, JsonSchema> {
  return asObject(schema?.["properties"]) as Record<string, JsonSchema>
}

export function schemaRequired(schema: JsonSchema | undefined): readonly string[] {
  const required = schema?.["required"]
  return Array.isArray(required) ? required.filter((item): item is string => typeof item === "string") : []
}

function schemaType(schema: JsonSchema): string {
  const type = schema["type"]
  return typeof type === "string" ? type : ""
}

export function schemaLabel(name: string, schema: JsonSchema): string {
  const title = schema["title"]
  return typeof title === "string" && title !== "" ? title : humanize(name)
}

export function schemaHint(schema: JsonSchema): string | undefined {
  const description = schema["description"]
  return typeof description === "string" && description !== "" ? description : undefined
}

function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of keys) out[key] = source[key]
  return out
}

/** Seed a config object from the schema's declared `default`s. */
export function defaultsFromSchema(schema: JsonSchema | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(schemaProperties(schema))) {
    if (field["default"] !== undefined) out[key] = field["default"]
  }
  return out
}

/** JSON textarea for untyped fields and keys the schema does not declare. */
function JsonField({
  label,
  hint,
  value,
  onChange,
  idPrefix,
}: {
  readonly label: string
  readonly hint?: string | undefined
  readonly value: unknown
  readonly onChange: (next: unknown) => void
  readonly idPrefix: string
}) {
  const [text, setText] = useState(() => JSON.stringify(value ?? {}, null, 2))
  const [error, setError] = useState<string | null>(null)
  const id = `${idPrefix}-json`

  function commit(): void {
    try {
      onChange(JSON.parse(text) as unknown)
      setError(null)
    } catch {
      setError("Invalid JSON")
    }
  }

  return (
    <Field label={label} htmlFor={id} hint={hint ?? "JSON"} error={error}>
      <Textarea
        id={id}
        rows={3}
        spellCheck={false}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
      />
    </Field>
  )
}

function SchemaField({
  name,
  schema,
  required,
  value,
  onChange,
  idPrefix,
}: {
  readonly name: string
  readonly schema: JsonSchema
  readonly required: boolean
  readonly value: unknown
  readonly onChange: (next: unknown) => void
  readonly idPrefix: string
}) {
  const id = `${idPrefix}-${name}`
  const label = schemaLabel(name, schema)
  const hint = schemaHint(schema)
  const type = schemaType(schema)
  const options = Array.isArray(schema["enum"]) ? (schema["enum"] as readonly unknown[]) : null

  if (options !== null) {
    return (
      <Field label={label} htmlFor={id} required={required} hint={hint}>
        <Select
          id={id}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(event) =>
            onChange(options.find((option) => String(option) === event.target.value) ?? event.target.value)
          }
        >
          <option value="">Select…</option>
          {options.map((option) => (
            <option key={String(option)} value={String(option)}>
              {String(option)}
            </option>
          ))}
        </Select>
      </Field>
    )
  }

  if (type === "boolean") {
    return (
      <Field label={label} hint={hint}>
        <Switch checked={value === true} onChange={(event) => onChange(event.target.checked)} />
      </Field>
    )
  }

  if (type === "integer" || type === "number") {
    return (
      <Field label={label} htmlFor={id} required={required} hint={hint}>
        <Input
          id={id}
          type="number"
          value={typeof value === "number" ? String(value) : ""}
          min={typeof schema["minimum"] === "number" ? schema["minimum"] : undefined}
          max={typeof schema["maximum"] === "number" ? schema["maximum"] : undefined}
          onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))}
        />
      </Field>
    )
  }

  if (type === "string") {
    return (
      <Field label={label} htmlFor={id} required={required} hint={hint}>
        <Input
          id={id}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        />
      </Field>
    )
  }

  if (type === "array") {
    return (
      <Field label={label} htmlFor={id} required={required} hint={hint ?? "Comma-separated values"}>
        <Input
          id={id}
          value={Array.isArray(value) ? value.join(", ") : ""}
          onChange={(event) =>
            onChange(
              event.target.value
                .split(",")
                .map((part) => part.trim())
                .filter((part) => part !== ""),
            )
          }
        />
      </Field>
    )
  }

  if (type === "object") {
    return (
      <details className="field" open>
        <summary className="field-label" style={{ cursor: "pointer" }}>
          {label}
        </summary>
        {hint !== undefined ? <span className="field-hint">{hint}</span> : null}
        <div className="stack-sm" style={{ marginTop: "var(--s-2)" }}>
          <SchemaForm schema={schema} value={asObject(value)} onChange={onChange} idPrefix={id} />
        </div>
      </details>
    )
  }

  return <JsonField label={label} hint={hint} value={value} onChange={onChange} idPrefix={id} />
}

export function SchemaForm({
  schema,
  value,
  onChange,
  idPrefix,
}: {
  readonly schema: JsonSchema | undefined
  readonly value: Record<string, unknown>
  readonly onChange: (next: Record<string, unknown>) => void
  readonly idPrefix: string
}) {
  const properties = schemaProperties(schema)
  const required = schemaRequired(schema)
  const keys = Object.keys(properties)
  const extras = Object.keys(value).filter((key) => !(key in properties))
  if (keys.length === 0 && extras.length === 0) return null

  return (
    <div className="stack">
      {keys.map((key) => (
        <SchemaField
          key={key}
          name={key}
          schema={properties[key]}
          required={required.includes(key)}
          value={value[key]}
          idPrefix={idPrefix}
          onChange={(next) => onChange({ ...value, [key]: next })}
        />
      ))}
      {extras.length > 0 ? (
        <JsonField
          label="Additional fields"
          value={pick(value, extras)}
          idPrefix={idPrefix}
          onChange={(next) => onChange({ ...pick(value, keys), ...asObject(next) })}
        />
      ) : null}
    </div>
  )
}
