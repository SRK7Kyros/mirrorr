import { useState, type ReactNode } from "react"
import { copyText } from "@/ui/lib/clipboard"
import { cn } from "@/ui/lib/cn"
import { IconCheck, IconChevronRight, IconCopy } from "./icons"
import { toast } from "./Toast"

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** One leaf value, coloured by JSON type. */
function Primitive({ value }: { readonly value: unknown }): ReactNode {
  if (value === null) return <span className="json-prim json-null">null</span>
  if (value === undefined) return <span className="json-prim json-null">undefined</span>
  if (typeof value === "string") return <span className="json-prim json-string">"{value}"</span>
  if (typeof value === "number") return <span className="json-prim json-number">{String(value)}</span>
  if (typeof value === "boolean") return <span className="json-prim json-boolean">{String(value)}</span>
  return <span className="json-prim json-null">{String(value)}</span>
}

interface JsonNodeProps {
  readonly label: string | null
  readonly value: unknown
  readonly defaultOpen: boolean
}

/** A recursive object/array branch (collapsible) or a leaf row. */
function JsonNode({ label, value, defaultOpen }: JsonNodeProps) {
  const [open, setOpen] = useState(defaultOpen)
  const array = Array.isArray(value)
  const object = isPlainObject(value)

  if (!array && !object) {
    return (
      <div className="json-row">
        {label !== null ? <span className="json-key">{label}:</span> : null}
        <Primitive value={value} />
      </div>
    )
  }

  const entries: readonly (readonly [string, unknown])[] = array
    ? (value as readonly unknown[]).map((item, index) => [String(index), item] as const)
    : Object.entries(value as Record<string, unknown>)
  const empty = entries.length === 0
  const preview = entries.slice(0, 4).map(([key]) => key).join(", ")
  const rest = entries.length - 4
  const collapsed = array
    ? `[${entries.length}]`
    : empty
      ? "{}"
      : `{ ${preview}${rest > 0 ? `, +${rest}` : ""} }`

  return (
    <div className="json-node">
      <button
        type="button"
        className="json-toggle"
        aria-expanded={open}
        disabled={empty}
        onClick={() => setOpen((prev) => !prev)}
      >
        {empty ? (
          <span className="json-chevron json-chevron-empty" aria-hidden="true" />
        ) : (
          <span className="json-chevron" data-open={open} aria-hidden="true">
            <IconChevronRight size={12} />
          </span>
        )}
        {label !== null ? <span className="json-key">{label}</span> : null}
        <span className="json-brace">{open ? (array ? "[" : "{") : collapsed}</span>
      </button>
      {open && !empty ? (
        <>
          <div className="json-children">
            {entries.map(([key, child]) => (
              <JsonNode key={key} label={key} value={child} defaultOpen={false} />
            ))}
          </div>
          <span className="json-brace json-brace-close">{array ? "]" : "}"}</span>
        </>
      ) : null}
    </div>
  )
}

export interface JsonViewProps {
  readonly value: unknown
  /** Optional heading; when present a copy-as-JSON button renders beside it. */
  readonly label?: string
  readonly className?: string
  /** Expand the root node on first render (default false). */
  readonly defaultOpen?: boolean
}

/**
 * Pretty, collapsible JSON tree — the readable replacement for stringifying a
 * schema or config object into a cell (`[object Object]`). Collapsed roots show
 * a compact `{n}` / `[n]` count; a labelled view carries a copy-JSON button.
 */
export function JsonView({ value, label, className, defaultOpen = false }: JsonViewProps) {
  const [copied, setCopied] = useState(false)
  const composite = Array.isArray(value) || isPlainObject(value)

  const copy = async (): Promise<void> => {
    try {
      const text = JSON.stringify(value, null, 2) ?? String(value)
      await copyText(text)
      setCopied(true)
      toast.success("Copied JSON", label ?? "Value")
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      toast.error("Could not copy", "Clipboard access was denied.")
    }
  }

  return (
    <div className={cn("json-view", className)}>
      {label !== undefined ? (
        <div className="json-view-head">
          <span className="json-view-label">{label}</span>
          <button
            type="button"
            className="json-copy"
            aria-label={`Copy ${label} as JSON`}
            onClick={() => void copy()}
          >
            {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
          </button>
        </div>
      ) : null}
      {composite ? (
        <JsonNode label={null} value={value} defaultOpen={defaultOpen} />
      ) : (
        <div className="json-row">
          <Primitive value={value} />
        </div>
      )}
    </div>
  )
}
