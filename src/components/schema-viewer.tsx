import { useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Check, Copy } from "lucide-react"

// ── Type colors ──────────────────────────────────────────────────────
const typeColor: Record<string, string> = {
  string: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/20",
  number: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20",
  integer: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20",
  boolean: "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/20",
  object: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  array: "bg-pink-500/15 text-pink-600 dark:text-pink-400 border-pink-500/20",
}

export function TypeBadge({ type }: { type: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-mono font-medium",
        typeColor[type] ?? "bg-muted text-muted-foreground"
      )}
    >
      {type}
    </span>
  )
}

// ── Resolve schema to flat properties ────────────────────────────────
// Handles both:
// 1. Flat dict: { field_name: { type, description, ... } }
// 2. JSON Schema: { properties: {...}, required: [...], type: "object", title: "..." }
function resolveSchema(
  schema: Record<string, any>
): { properties: Record<string, any>; required: Set<string> } {
  // If it has a `properties` key that's an object, treat as JSON Schema
  if (schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)) {
    return {
      properties: schema.properties,
      required: new Set(schema.required ?? []),
    }
  }
  // Already a flat dict of properties
  return {
    properties: schema,
    required: new Set(),
  }
}

// ── Schema table ─────────────────────────────────────────────────────
export function SchemaTable({
  schema,
  requiredFields,
}: {
  schema: Record<string, any>
  requiredFields?: string[]
}) {
  if (!schema || Object.keys(schema).length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-4 text-center">
        No properties
      </p>
    )
  }

  const { properties, required: schemaRequired } = resolveSchema(schema)
  const required =
    requiredFields && requiredFields.length > 0
      ? new Set(requiredFields)
      : schemaRequired

  return (
    <div className="overflow-hidden rounded-xl border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">
              Field
            </th>
            <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">
              Type
            </th>
            <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground hidden sm:table-cell">
              Description
            </th>
            <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground hidden md:table-cell">
              Default
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {Object.entries(properties).map(([key, prop]) => {
            const p = prop as any
            // Skip non-schema keys that leaked in
            if (key === "type" || key === "title" || key === "$schema") return null
            return (
              <tr
                key={key}
                className="transition-colors"
              >
                <td className="px-3 py-2">
                  <code className="font-mono font-semibold text-foreground">
                    {key}
                  </code>
                  {required.has(key) && (
                    <span className="ml-1.5 text-[9px] font-medium text-destructive uppercase tracking-wider">
                      req
                    </span>
                  )}
                  {p.enum && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {p.enum.map((v: string) => (
                        <code
                          key={v}
                          className="text-[9px] font-mono rounded bg-muted px-1 py-px text-muted-foreground"
                        >
                          {JSON.stringify(v)}
                        </code>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <TypeBadge type={p.type ?? "unknown"} />
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground hidden sm:table-cell max-w-50">
                  {p.description ? (
                    p.description
                  ) : (
                    <span className="text-muted-foreground/40">-</span>
                  )}
                </td>
                <td className="px-3 py-2 hidden md:table-cell">
                  {p.default !== undefined ? (
                    <code className="text-xs font-mono text-muted-foreground">
                      {JSON.stringify(p.default)}
                    </code>
                  ) : (
                    <span className="text-muted-foreground/40 text-xs">-</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Copy button ──────────────────────────────────────────────────────
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className="opacity-50 hover:opacity-100 transition-opacity"
      onClick={() => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
    </Button>
  )
}

