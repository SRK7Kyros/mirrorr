/**
 * Spec L546/L614: when the environment cannot start a download the validated
 * bundle JSON is offered for manual copy instead. Shared by the desktop export
 * button and the compact action sheet.
 */
import { Button } from "@/components/ui/Button"
import { Dialog } from "@/components/ui/Dialog"
import { FOCUS_RING } from "@/components/ui/focus-ring"
import { copyText } from "@/lib/clipboard"
import { showToast } from "@/lib/toast"

export const EXPORT_FALLBACK_TITLE = "Export ready — copy the JSON"

const COPIED_MESSAGE = "JSON copied"
const COPY_FAILED_MESSAGE = "Could not copy the JSON"

export interface ExportFallbackDialogProps {
  readonly json: string | null
  readonly onClose: () => void
}

export function ExportFallbackDialog({ json, onClose }: ExportFallbackDialogProps) {
  async function copyJson() {
    if (json === null) return
    const copied = await copyText(json)
    showToast(copied ? COPIED_MESSAGE : COPY_FAILED_MESSAGE, copied ? "info" : "error")
  }

  return (
    <Dialog
      open={json !== null}
      onClose={onClose}
      title={EXPORT_FALLBACK_TITLE}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" onClick={() => void copyJson()}>
            Copy JSON
          </Button>
        </>
      }
    >
      <label className="flex flex-col gap-1 text-small text-text-secondary">
        Exported bundle JSON
        <textarea
          data-testid="export-fallback-json"
          readOnly
          rows={12}
          value={json ?? ""}
          className={[
            "w-full rounded-control border border-border bg-bg-raised px-2 py-1 font-mono text-small text-text-primary",
            FOCUS_RING,
          ].join(" ")}
        />
      </label>
      <p className="mt-2 text-small text-text-muted">
        The download could not start in this browser — copy the JSON and save it as a .json file.
      </p>
    </Dialog>
  )
}
