/**
 * Pure helpers behind `DynamicSchemaForm` and D1's submission builder.
 *
 * Contract: `docs/web-frontend-spec.md` L403 — defaults and `default_params`
 * prefill, required markers, `{...defaults, ...values}` emission and 422
 * `loc`-path mapping. Keeping the logic pure makes both the form and the
 * submission rules unit-testable without a DOM.
 */
import { isObjectSchema, readJsonSchema, type JsonSchema } from "@/lib/schemas/json-schema"

export type ConfigValues = Readonly<Record<string, unknown>>

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** "retry_after" → "Retry after"; used when a schema field has no title. */
export function humanizeKey(key: string): string {
  const spaced = key.replace(/_/g, " ").trim()
  if (spaced.length === 0) return key
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function fieldLabel(schema: JsonSchema, key: string): string {
  const title = schema.title?.trim()
  return title && title.length > 0 ? title : humanizeKey(key)
}

/** Declared defaults, one level of object nesting (e.g. `headers: {}`). */
export function schemaDefaults(schema: JsonSchema | undefined): Record<string, unknown> {
  if (!schema?.properties) return {}

  const out: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(schema.properties)) {
    const child = readJsonSchema(raw)
    if (child.default !== undefined) {
      out[key] = child.default
      continue
    }
    if (isObjectSchema(child)) {
      const nested = schemaDefaults(child)
      if (Object.keys(nested).length > 0) out[key] = nested
    }
  }
  return out
}

/** `{...default_params, ...values}` (spec L403). */
export function mergeConfig(defaults: ConfigValues, values: ConfigValues): Record<string, unknown> {
  return { ...defaults, ...values }
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === "string") return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

/**
 * Required keys that are missing/blank, as dotted paths relative to `prefix`
 * (e.g. `["url"]` or `["resolver_config.url"]`). Recurses into nested objects.
 */
export function requiredMissing(schema: JsonSchema | undefined, values: ConfigValues, prefix = ""): readonly string[] {
  if (!schema) return []

  const missing: string[] = []
  for (const key of schema.required ?? []) {
    if (isEmpty(values[key])) missing.push(prefix.length > 0 ? `${prefix}.${key}` : key)
  }

  for (const [key, raw] of Object.entries(schema.properties ?? {})) {
    const child = readJsonSchema(raw)
    const nested = values[key]
    if (isObjectSchema(child) && child.required && child.required.length > 0 && isPlainObject(nested)) {
      missing.push(...requiredMissing(child, nested, prefix.length > 0 ? `${prefix}.${key}` : key))
    }
  }

  return missing
}

/** "1, 2 3" → [1, 2, 3]; non-numeric tokens are dropped (tag-input parsing). */
export function parseIntegerListText(text: string): number[] {
  return text
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => Number(token))
    .filter((token) => Number.isFinite(token))
}

export function formatIntegerListText(value: unknown): string {
  if (!Array.isArray(value)) return ""
  return value.filter((item): item is number => typeof item === "number").join(", ")
}

/** Schema keys in declaration order; `Object.entries` preserves insertion. */
export function schemaProperties(schema: JsonSchema | undefined): ReadonlyArray<readonly [string, JsonSchema]> {
  if (!schema?.properties) return []
  return Object.entries(schema.properties).map(([key, raw]) => [key, readJsonSchema(raw)] as const)
}

/** True when the schema wants key/value rows (`additionalProperties` object). */
export function schemaWantsKeyValues(schema: JsonSchema): boolean {
  if (schema.additionalProperties === false) return false
  if (isPlainObject(schema.additionalProperties)) return true
  return isObjectSchema(schema) && schema.properties === undefined
}
