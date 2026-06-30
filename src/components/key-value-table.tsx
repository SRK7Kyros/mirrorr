import { useState, isValidElement } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { CopyButton } from "@/components/schema-viewer"
import { Braces } from "lucide-react"
import { ReactNode } from "react"

interface KeyValueTableProps {
  title: string
  entries: [string, unknown][]
  emptyText?: string
  /** Show a "Raw JSON" button that opens the raw JSON in a modal */
  json?: unknown
  /** Render the value cell custom. Receives the raw value and should return a ReactNode. */
  renderValue?: (key: string, value: unknown) => ReactNode
}

export function KeyValueTable({ title, entries, emptyText, json, renderValue }: KeyValueTableProps) {
  const [jsonOpen, setJsonOpen] = useState(false)
  const isEmpty = entries.length === 0

  return (
    <>
      <div className="border rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b bg-muted/20 flex items-center justify-between">
          <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{title}</h3>
          {json !== undefined && !isEmpty && (
            <button
              onClick={() => setJsonOpen(true)}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <Braces className="size-3" />
              Raw JSON
            </button>
          )}
        </div>
        {isEmpty ? (
          <p className="text-xs text-muted-foreground/40 py-4 text-center">{emptyText ?? "No properties"}</p>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {entries.map(([key, value]) => (
                <tr key={key} className="transition-colors">
                  <td className="px-4 py-2.5">
                    <code className="font-mono font-semibold text-foreground text-[12px]">{key}</code>
                  </td>
                  <td className="px-4 py-2.5">
                    {renderValue
                      ? renderValue(key, value)
                      : isValidElement(value)
                        ? value
                        : <code className="text-[11px] font-mono text-muted-foreground">{typeof value === "string" ? value : String(value)}</code>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {json !== undefined && jsonOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setJsonOpen(false)}>
          <div className="bg-card border rounded-lg shadow-xl w-[90vw] max-w-3xl h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0">
              <h3 className="text-xs font-semibold">{title} — Raw JSON</h3>
              <div className="flex items-center gap-2">
                <CopyButton text={JSON.stringify(json, null, 2)} />
                <button onClick={() => setJsonOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
              </div>
            </div>
            <ScrollArea className="flex-1 min-h-0">
              <pre className="p-4 text-[11px] font-mono text-muted-foreground leading-relaxed whitespace-pre">
                {JSON.stringify(json, null, 2)}
              </pre>
            </ScrollArea>
          </div>
        </div>
      )}
    </>
  )
}
