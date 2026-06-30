/**
 * Reusable config display block — key-value table with optional raw JSON modal.
 * Used in profile detail and plugin detail pages.
 */
import { useState } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Braces, Copy, Check } from "lucide-react"

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false)
  return (
    <Button variant="ghost" size="icon-xs"
      onClick={() => navigator.clipboard.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1500) })}
      title="Copy">
      {ok ? <Check className="size-3" /> : <Copy className="size-3" />}
    </Button>
  )
}

interface ConfigBlockProps {
  title: string
  config: Record<string, unknown> | null | undefined
  emptyText?: string
}

export function ConfigBlock({ title, config, emptyText = "No properties" }: ConfigBlockProps) {
  const [jsonOpen, setJsonOpen] = useState(false)
  const entries = config ? Object.entries(config) : []
  const isEmpty = entries.length === 0

  return (
    <>
      <div className="border rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b bg-muted/20 flex items-center justify-between">
          <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{title}</h3>
          {!isEmpty && (
            <Button variant="ghost" size="icon-xs" onClick={() => setJsonOpen(true)} title="View raw JSON">
              <Braces className="size-3" />
            </Button>
          )}
        </div>
        {isEmpty ? (
          <p className="text-xs text-muted-foreground/40 py-4 text-center">{emptyText}</p>
        ) : (
          <Table>
            <TableBody>
              {entries.map(([key, value]) => (
                <TableRow key={key}>
                  <TableCell>
                    <code className="font-mono font-semibold text-foreground text-[12px]">{key}</code>
                  </TableCell>
                  <TableCell className="text-right">
                    <code className="text-[11px] font-mono text-muted-foreground">
                      {typeof value === "string" ? value : JSON.stringify(value)}
                    </code>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog open={jsonOpen} onOpenChange={setJsonOpen}>
        <DialogContent className="max-w-3xl h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{title} — Raw JSON</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-end gap-2 shrink-0">
            <CopyBtn text={JSON.stringify(config, null, 2)} />
          </div>
          <ScrollArea className="flex-1 min-h-0">
            <pre className="p-4 text-[11px] font-mono text-muted-foreground leading-relaxed whitespace-pre">
              {JSON.stringify(config, null, 2)}
            </pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  )
}
