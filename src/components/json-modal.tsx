/**
 * Reusable fullscreen JSON viewer modal.
 * Used by KeyValueTable, plugins page ConfigSchemaBlock, and RetryModesBlock.
 */
import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { CopyButton } from "@/components/schema-viewer"

interface JsonModalProps {
  title: string
  data: unknown
  /** Render a trigger button. Receives onClick to open the modal. */
  trigger: (onClick: () => void) => React.ReactNode
}

export function JsonModal({ title, data, trigger }: JsonModalProps) {
  const [open, setOpen] = useState(false)
  const json = JSON.stringify(data, null, 2)

  return (
    <>
      {trigger(() => setOpen(true))}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{title} — Raw JSON</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-end shrink-0">
            <CopyButton text={json} />
          </div>
          <ScrollArea className="flex-1 min-h-0">
            <pre className="p-4 text-[11px] font-mono text-muted-foreground leading-relaxed whitespace-pre">
              {json}
            </pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  )
}
