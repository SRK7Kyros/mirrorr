import { useEffect, useRef } from "react"
import { Input } from "./Input"
import { Select } from "./Select"
import { Switch } from "./Switch"
import { IconX } from "./icons"
import { SchemaGroup, TagInput } from "./schema-widgets"

/**
 * JSON Schema → form controls (design spec §5 DynamicSchemaForm).
 * Mapping: string→Input (textarea for long strings) · number/integer→number
 * Input · boolean→Switch · enum→Select · array of integers→tag input ·
 * nested object→collapsible group · unknown extra keys→key/value rows.
 * `default`/`default_params` prefill via `prefillSchemaValues`; required →
 * `*` + aria-required; every control's id/htmlFor derives from the schema
 * path (`path-key`). Emits `{...default_params, ...values}` semantics from
 * the caller's perspective — the parent owns the merged value record.
 */

export interface JsonSchema {
  readonly type?: string
  readonly title?: string
  readonly description?: string
  readonly default?: unknown
  readonly default_params?: Record<string, unknown>
  readonly enum?: ReadonlyArray<unknown>
  readonly minimum?: number
  readonly maximum?: number
  readonly maxLength?: number
  readonly properties?: Record<string, JsonSchema>
  readonly items?: JsonSchema
  readonly required?: ReadonlyArray<string>
  readonly additionalProperties?: boolean | JsonSchema
  readonly [key: string]: unknown
}

export type SchemaValues = Record<string, unknown>

export interface DynamicSchemaFormProps {
  readonly schema: Record<string, unknown> | undefined
  readonly value: SchemaValues
  readonly onChange: (next: SchemaValues) => void
  readonly path: string
  readonly errors?: Readonly<Record<string, string>>
  readonly disabled?: boolean
  readonly legend?: string
}

const LONG_STRING_CHARS = 120

/** `{...default_params, ...schema.default, ...existing}` — prefill rule. */
export function prefillSchemaValues(
  schema: Record<string, unknown> | undefined,
  existing: SchemaValues | undefined,
): SchemaValues {
  const s = schema as JsonSchema | undefined
  const defaults: SchemaValues = {
    ...((s?.default_params as SchemaValues | undefined) ?? {}),
  }
  const props = s?.properties ?? {}
  for (const [key, prop] of Object.entries(props)) {
    if (prop.default !== undefined && defaults[key] === undefined) {
      defaults[key] = prop.default
    }
  }
  return { ...defaults, ...(existing ?? {}) }
}

/** Required-but-missing leaves → error map (submit validation helper). */
export function requiredFieldErrors(
  schema: Record<string, unknown> | undefined,
  value: SchemaValues,
): Record<string, string> {
  const s = schema as JsonSchema | undefined
  const errors: Record<string, string> = {}
  for (const key of s?.required ?? []) {
    const raw = value[key]
    const missing = raw === undefined || raw === null || raw === "" || raw === false
    if (missing) errors[key] = "This field is required"
  }
  return errors
}

function humanize(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

function isLongString(prop: JsonSchema): boolean {
  return prop.format === "textarea" || (prop.maxLength ?? 0) > LONG_STRING_CHARS
}

function enumOptions(prop: JsonSchema): Array<{ value: string; label: string }> {
  return (prop.enum ?? []).map((entry) => {
    const value = String(entry)
    return { value, label: value }
  })
}

interface FieldProps {
  readonly name: string
  readonly prop: JsonSchema
  readonly path: string
  readonly value: unknown
  readonly error: string | undefined
  readonly disabled: boolean
  readonly required: boolean
  readonly onChange: (next: unknown) => void
}

function FieldControl({ name, prop, path, value, error, disabled, required, onChange }: FieldProps) {
  const label = prop.title ?? humanize(name)
  const helper = prop.description

  if (prop.type === "boolean") {
    return (
      <Switch
        id={`${path}-${name}`}
        label={label}
        showLabel
        checked={value === true}
        disabled={disabled}
        onChange={(next) => onChange(next)}
      />
    )
  }

  if (prop.enum !== undefined) {
    return (
      <Select
        id={`${path}-${name}`}
        label={label}
        options={enumOptions(prop)}
        value={value === undefined || value === null ? null : String(value)}
        placeholder="choose manually"
        helper={error ?? helper}
        error={error}
        disabled={disabled}
        required={required}
        onChange={(next) => onChange(next)}
      />
    )
  }

  if (prop.type === "array") {
    return (
      <TagInput
        id={`${path}-${name}`}
        label={label}
        helper={error ?? helper}
        error={error}
        disabled={disabled}
        value={Array.isArray(value) ? value : []}
        onChange={onChange}
      />
    )
  }

  if (prop.type === "object") {
    const nested = (value ?? {}) as SchemaValues
    return (
      <SchemaGroup legend={label}>
        <DynamicSchemaForm
          schema={prop.properties ?? {}}
          value={nested}
          onChange={(next) => onChange(next)}
          path={`${path}-${name}`}
          errors={error === undefined ? undefined : { [name]: error }}
          disabled={disabled}
        />
      </SchemaGroup>
    )
  }

  if (prop.type === "string" && isLongString(prop)) {
    const describedBy = helper === undefined ? undefined : `${path}-${name}-helper`
    return (
      <div className="field">
        <label className="field__label" htmlFor={`${path}-${name}`}>
          {label}
          {required ? <span className="field__required">*</span> : null}
        </label>
        <textarea
          id={`${path}-${name}`}
          className="input"
          rows={4}
          disabled={disabled}
          required={required}
          aria-required={required || undefined}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={describedBy}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(event) => onChange(event.target.value)}
        />
        {helper === undefined ? null : (
          <span className="field__helper" id={describedBy}>
            {helper}
          </span>
        )}
        {error === undefined ? null : (
          <span className="field__helper field__helper--error">{error}</span>
        )}
      </div>
    )
  }

  const isNumber = prop.type === "number" || prop.type === "integer"

  if (prop.type === undefined && typeof value === "object" && value !== null) {
    return (
      <SchemaGroup legend={label}>
        <p className="t-meta">{JSON.stringify(value)}</p>
      </SchemaGroup>
    )
  }

  return (
    <Input
      id={`${path}-${name}`}
      label={label}
      helper={helper}
      error={error}
      disabled={disabled}
      required={required}
      mono={!isNumber && prop.format === "mono"}
      type={isNumber ? "number" : "text"}
      step={prop.type === "integer" ? 1 : undefined}
      min={prop.minimum}
      max={prop.maximum}
      value={value === undefined || value === null ? "" : String(value)}
      onChange={(event) => {
        const raw = event.target.value
        if (isNumber) onChange(raw === "" ? undefined : Number(raw))
        else onChange(raw)
      }}
    />
  )
}

function labelOf(name: string, prop: JsonSchema): string {
  return prop.title ?? humanize(name)
}

export function DynamicSchemaForm({
  schema,
  value,
  onChange,
  path,
  errors,
  disabled = false,
  legend,
}: DynamicSchemaFormProps) {
  const s = (schema ?? {}) as JsonSchema
  const props = s.properties ?? {}
  const knownKeys = new Set(Object.keys(props))
  const extras = Object.keys(value).filter((key) => !knownKeys.has(key))
  const required = new Set(s.required ?? [])
  const rootRef = useRef<HTMLDivElement | null>(null)

  // Focus-first-invalid (spec §4 DynamicSchemaForm): when a submit surfaces
  // field errors, move focus to the first invalid control after state settles.
  useEffect(() => {
    if (errors === undefined || Object.keys(errors).length === 0) return
    const first = rootRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
    first?.focus()
  }, [errors])

  const setKey = (key: string, next: unknown) => {
    onChange({ ...value, [key]: next })
  }

  const body = (
    <div className="schema-form" ref={rootRef}>
      {Object.entries(props).map(([name, prop]) => (
        <FieldControl
          key={name}
          name={name}
          prop={prop}
          path={path}
          value={value[name]}
          error={errors?.[name]}
          disabled={disabled}
          required={required.has(name)}
          onChange={(next) => setKey(name, next)}
        />
      ))}
      {extras.map((key) => (
        <div key={key} className="cluster">
          <Input
            id={`${path}-${key}-key`}
            label="Key"
            mono
            value={key}
            disabled
            fieldClassName="field"
          />
          <Input
            id={`${path}-${key}-val`}
            label={labelOf(key, {})}
            mono
            disabled={disabled}
            value={value[key] === undefined || value[key] === null ? "" : String(value[key])}
            onChange={(event) => setKey(key, event.target.value)}
          />
          <button
            type="button"
            className="icon-btn"
            aria-label={`Remove ${key}`}
            disabled={disabled}
            onClick={() => {
              const next = { ...value }
              delete next[key]
              onChange(next)
            }}
          >
            <IconX size={14} />
          </button>
        </div>
      ))}
    </div>
  )

  if (legend === undefined) return body
  return (
    <fieldset>
      <legend className="fieldset__legend">{legend}</legend>
      {body}
    </fieldset>
  )
}
