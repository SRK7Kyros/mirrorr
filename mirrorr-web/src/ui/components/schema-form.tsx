import { useEffect, useRef, useState } from "react"
import { humanize } from "@/ui/lib/format"
import { Field } from "./Field"
import { IconButton } from "./IconButton"
import { IconTrash } from "./icons"
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

/**
 * The value schema of a map-shaped object (`additionalProperties`), or `null`
 * when the schema forbids extra keys. A bare `{"type": "object"}` — or
 * `additionalProperties: true` — allows any value, which `{}` expresses.
 */
function schemaMapValue(schema: JsonSchema): JsonSchema | null {
  const additional = schema["additionalProperties"]
  if (additional === false) return null
  if (additional !== null && typeof additional === "object" && !Array.isArray(additional)) {
    return additional as JsonSchema
  }
  return {}
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

/** Coerce a map row's text to the type its value schema declares. */
function coerceMapValue(text: string, valueSchema: JsonSchema): unknown {
  const type = schemaType(valueSchema)
  if (type === "integer" || type === "number") {
    const num = Number(text)
    return text !== "" && Number.isFinite(num) ? num : text
  }
  if (type === "boolean") return text === "true"
  return text
}

interface MapRow {
  readonly id: number
  readonly key: string
  readonly value: string
}

let mapRowSeq = 0
function nextMapRowId(): number {
  mapRowSeq += 1
  return mapRowSeq
}

function blankRow(): MapRow {
  return { id: nextMapRowId(), key: "", value: "" }
}

/** The editor always trails one empty row, so the next entry is always in reach. */
function normalizeRows(rows: readonly MapRow[]): MapRow[] {
  return rows.some((row) => row.key.trim() === "") ? [...rows] : [...rows, blankRow()]
}

function mapRowsFromValue(value: unknown): MapRow[] {
  return normalizeRows(
    Object.entries(asObject(value)).map(([key, item]) => ({
      id: nextMapRowId(),
      key,
      value: item === undefined || item === null ? "" : String(item),
    })),
  )
}

/**
 * Key/value editor for a map-shaped object — a `dict[str, str]` such as a
 * resolver's request headers, which no single text input can express. Rows
 * commit on every edit; blank keys are dropped from the emitted object, and
 * filling the last row spawns a fresh blank one, so there is no "add" button.
 */
function MapField({
  label,
  hint,
  required,
  value,
  valueSchema,
  onChange,
}: {
  readonly label: string
  readonly hint?: string | undefined
  readonly required: boolean
  readonly value: unknown
  readonly valueSchema: JsonSchema
  readonly onChange: (next: unknown) => void
}) {
  const incoming = JSON.stringify(asObject(value))
  const emitted = useRef(incoming)
  const [rows, setRows] = useState<MapRow[]>(() => mapRowsFromValue(value))

  // Re-seed when the value arrives from outside (resolver switch, source
  // pick, discovery "Use"), but never when it is the echo of our own edit.
  useEffect(() => {
    if (incoming === emitted.current) return
    emitted.current = incoming
    setRows(mapRowsFromValue(value))
  }, [incoming, value])

  function commit(next: readonly MapRow[]): void {
    setRows(normalizeRows(next))
    const out: Record<string, unknown> = {}
    for (const row of next) {
      const key = row.key.trim()
      if (key === "") continue
      out[key] = coerceMapValue(row.value, valueSchema)
    }
    emitted.current = JSON.stringify(out)
    onChange(out)
  }

  return (
    <div className="field" role="group" aria-label={label}>
      <div className="field-label">
        {label}
        {required ? (
          <span className="field-req" aria-hidden="true">
            *
          </span>
        ) : null}
      </div>
      {hint !== undefined ? <span className="field-hint">{hint}</span> : null}
      <div className="map-rows">
        {rows.map((row, index) => (
          <div className="map-row" key={row.id}>
            <Input
              className="map-key"
              aria-label={`${label} — key ${index + 1}`}
              placeholder="Key"
              value={row.key}
              onChange={(event) =>
                commit(rows.map((item) => (item.id === row.id ? { ...item, key: event.target.value } : item)))
              }
            />
            <Input
              className="map-value"
              aria-label={`${label} — value ${index + 1}`}
              placeholder="Value"
              value={row.value}
              onChange={(event) =>
                commit(rows.map((item) => (item.id === row.id ? { ...item, value: event.target.value } : item)))
              }
            />
            <IconButton
              label={`Remove ${label} entry ${index + 1}`}
              icon={<IconTrash size={16} />}
              variant="danger-ghost"
              size="sm"
              onClick={() => commit(rows.filter((item) => item.id !== row.id))}
            />
          </div>
        ))}
      </div>
    </div>
  )
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
  const emitted = useRef(text)
  const incoming = JSON.stringify(value ?? {}, null, 2)
  const id = `${idPrefix}-json`

  // Keep the buffer in step with a value that changed elsewhere, without
  // clobbering what the user is mid-way through typing.
  useEffect(() => {
    if (incoming === emitted.current) return
    emitted.current = incoming
    setText(incoming)
    setError(null)
  }, [incoming])

  function commit(): void {
    try {
      const parsed = JSON.parse(text) as unknown
      emitted.current = JSON.stringify(parsed, null, 2)
      onChange(parsed)
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
      <Field label={label} htmlFor={id} hint={hint}>
        <Switch
          id={id}
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
        />
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
          onChange={(event) => {
            const next = Number(event.target.value)
            onChange(event.target.value === "" ? undefined : Number.isFinite(next) ? next : value)
          }}
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
    if (Object.keys(schemaProperties(schema)).length > 0) {
      return (
        <details className="field" open>
          <summary className="field-label">{label}</summary>
          {hint !== undefined ? <span className="field-hint">{hint}</span> : null}
          <SchemaForm schema={schema} value={asObject(value)} onChange={onChange} idPrefix={id} />
        </details>
      )
    }
    const mapValue = schemaMapValue(schema)
    if (mapValue !== null) {
      return (
        <MapField
          label={label}
          hint={hint}
          required={required}
          value={value}
          valueSchema={mapValue}
          onChange={onChange}
        />
      )
    }
    return <JsonField label={label} hint={hint} value={value} onChange={onChange} idPrefix={id} />
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
