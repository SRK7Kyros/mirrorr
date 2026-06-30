import { useMemo } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { TagInput } from "@/components/tag-input"
import { cn } from "@/lib/utils"

// ── Types ────────────────────────────────────────────────────────────

interface SchemaProperty {
  type?: string
  title?: string
  description?: string
  default?: unknown
  enum?: string[]
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  format?: string
  properties?: Record<string, SchemaProperty>
  items?: SchemaProperty
  anyOf?: Array<{ type?: string; enum?: string[]; properties?: Record<string, SchemaProperty> }>
  const?: unknown
}

interface JsonSchema {
  type?: string
  title?: string
  description?: string
  properties?: Record<string, SchemaProperty>
  required?: string[]
}

interface DynamicFormProps {
  schema: JsonSchema
  value: Record<string, unknown>
  onChange: (v: Record<string, unknown>) => void
  className?: string
}

// ── Main form component ──────────────────────────────────────────────

export function DynamicForm({ schema, value, onChange, className }: DynamicFormProps) {
  const properties = schema.properties ?? {}
  const required = useMemo(() => new Set(schema.required ?? []), [schema.required])

  const updateField = (key: string, v: unknown) => onChange({ ...value, [key]: v })

  if (Object.keys(properties).length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-4 text-center">
        No configurable properties
      </div>
    )
  }

  return (
    <div className={cn("space-y-5", className)}>
      {schema.title && <h4 className="text-sm font-semibold">{schema.title}</h4>}
      {schema.description && <p className="text-xs text-muted-foreground">{schema.description}</p>}
      {Object.entries(properties).map(([key, prop]) => (
        <SchemaField
          key={key}
          name={key}
          prop={prop}
          required={required.has(key)}
          value={value[key]}
          onChange={(v) => updateField(key, v)}
        />
      ))}
    </div>
  )
}

// ── Schema type badge ────────────────────────────────────────────────

const typeColors: Record<string, string> = {
  string: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  number: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  integer: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  boolean: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  object: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  array: "bg-pink-500/10 text-pink-600 dark:text-pink-400",
}

function TypeTag({ type }: { type: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-mono font-medium", typeColors[type] ?? "bg-muted text-muted-foreground")}>
      {type}
    </span>
  )
}

// ── Single field renderer ────────────────────────────────────────────

function SchemaField({
  name,
  prop,
  required,
  value,
  onChange,
}: {
  name: string
  prop: SchemaProperty
  required: boolean
  value: unknown
  onChange: (v: unknown) => void
}) {
  const label = prop.title ?? name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  const description = prop.description
  let effectiveType = prop.type ?? "string"

  // Resolve anyOf — pick first variant
  if (prop.anyOf && prop.anyOf.length > 0) {
    const enumOption = prop.anyOf.find((o) => o.enum)
    if (enumOption?.enum) {
      return (
        <FieldWrapper label={label} required={required} type={enumOption.type ?? "string"} description={description}>
          <Select value={String(value ?? "")} onValueChange={onChange}>
            <SelectTrigger>
              <SelectValue placeholder={`Select ${label.toLowerCase()}...`} />
            </SelectTrigger>
            <SelectContent>
              {enumOption.enum.map((opt) => (
                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldWrapper>
      )
    }
    effectiveType = prop.anyOf[0]?.type ?? "string"
  }

  // Const
  if (prop.const !== undefined) {
    return (
      <FieldWrapper label={label} required={false} type="const" description={description}>
        <Input value={String(prop.const)} disabled className="opacity-60" />
      </FieldWrapper>
    )
  }

  // Boolean
  if (effectiveType === "boolean") {
    return (
      <div className="flex items-center justify-between py-2 px-3 rounded-xl hover:bg-muted/30 transition-colors">
        <div className="space-y-0.5 min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Label className="text-sm font-medium cursor-pointer">{label}</Label>
            <TypeTag type="boolean" />
            {required && <span className="text-[10px] font-medium text-destructive uppercase tracking-wider">required</span>}
          </div>
          {description && <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>}
        </div>
        <Switch checked={Boolean(value)} onCheckedChange={onChange} className="shrink-0 ml-4" />
      </div>
    )
  }

  // Enum (top-level)
  if (prop.enum) {
    return (
      <FieldWrapper label={label} required={required} type="enum" description={description}>
        <Select value={String(value ?? "")} onValueChange={onChange}>
          <SelectTrigger>
            <SelectValue placeholder={`Select ${label.toLowerCase()}...`} />
          </SelectTrigger>
          <SelectContent>
            {prop.enum.map((opt) => (
              <SelectItem key={opt} value={opt}>{opt}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldWrapper>
    )
  }

  // Number / integer
  if (effectiveType === "number" || effectiveType === "integer") {
    return (
      <FieldWrapper label={label} required={required} type={effectiveType} description={description}>
        <Input
          type="number"
          value={value != null ? String(value) : ""}
          onChange={(e) => {
            const v = effectiveType === "integer" ? parseInt(e.target.value, 10) : parseFloat(e.target.value)
            onChange(isNaN(v) ? undefined : v)
          }}
          min={prop.minimum}
          max={prop.maximum}
          placeholder={description || `Enter ${label.toLowerCase()}...`}
        />
        {prop.minimum !== undefined && prop.maximum !== undefined && (
          <p className="text-[11px] text-muted-foreground/60 mt-0.5">
            Range: {prop.minimum} – {prop.maximum}
          </p>
        )}
      </FieldWrapper>
    )
  }

  // Object (nested)
  if (effectiveType === "object" && prop.properties) {
    return (
      <div className="space-y-2 py-2 px-3 border-l-2 border-muted rounded-r-xl bg-muted/10">
        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium">{label}</Label>
          <TypeTag type="object" />
        </div>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
        <DynamicForm
          schema={{ properties: prop.properties }}
          value={(typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>}
          onChange={onChange}
        />
      </div>
    )
  }

  // Array
  if (effectiveType === "array") {
    const itemType = prop.items?.type ?? "string"
    return (
      <FieldWrapper label={label} required={required} type="array" description={description}>
        {(itemType === "number" || itemType === "integer") ? (
          <TagInput
            type={itemType as "number" | "integer"}
            value={Array.isArray(value) ? (value as (string | number)[]) : []}
            onChange={(tags) => onChange(tags)}
            placeholder={`Add ${label.toLowerCase()}...`}
          />
        ) : (
          <TagInput
            type="string"
            value={Array.isArray(value) ? (value as (string | number)[]) : []}
            onChange={(tags) => onChange(tags)}
            placeholder={`Add ${label.toLowerCase()}...`}
          />
        )}
      </FieldWrapper>
    )
  }

  // Default: string / text
  return (
    <FieldWrapper label={label} required={required} type="string" description={description}>
      <Input
        type={prop.format === "url" || prop.format === "uri" ? "url" : prop.format === "email" ? "email" : "text"}
        value={value != null ? String(value) : ""}
        onChange={(e) => onChange(e.target.value)}
        minLength={prop.minLength}
        maxLength={prop.maxLength}
        placeholder={description || `Enter ${label.toLowerCase()}...`}
      />
    </FieldWrapper>
  )
}

// ── Field wrapper (label + description + badge + required) ───────────

function FieldWrapper({
  label,
  required,
  type,
  description,
  children,
}: {
  label: string
  required: boolean
  type: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label className="text-sm font-medium">{label}</Label>
        <TypeTag type={type} />
        {required && <span className="text-[10px] font-medium text-destructive uppercase tracking-wider">required</span>}
      </div>
      {children}
      {description && <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>}
    </div>
  )
}
