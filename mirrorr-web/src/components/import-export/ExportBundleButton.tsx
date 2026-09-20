/**
 * Per-row export control — spec L331 (profiles), L295 (autoruns), L546/L614
 * (download mechanics), contract §9/§13.5.
 *
 * The export is an authenticated `apiFetchText` GET (never a token-bearing
 * link); the payload is validated against `bundleSchema` inside
 * `import-export-api`, then either handed to the browser as a `.json`
 * download (Blob → object URL, revoked immediately) or kept in the
 * "Export ready — copy the JSON" dialog when the environment cannot start a
 * download. Failures surface through `userMessageForError`.
 */
import { Download } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/Button"
import { Dialog } from "@/components/ui/Dialog"
import { FOCUS_RING } from "@/components/ui/focus-ring"
import { copyText } from "@/lib/clipboard"
import { downloadJson } from "@/lib/download"
import { userMessageForError } from "@/lib/errors"
import { exportAutorunBundle, exportProfileBundle } from "@/lib/import-export-api"
import { showToast } from "@/lib/toast"

export interface ExportBundleButtonProps {
  readonly kind: "profile" | "autorun"
  readonly id: number
  /** Row label, used for the accessible name and the toast copy. */
  readonly name: string
  readonly disabled?: boolean
}

export const EXPORT_FALLBACK_TITLE = "Export ready — copy the JSON"

const COPIED_MESSAGE = "JSON copied"
const COPY_FAILED_MESSAGE = "Could not copy the JSON"

export function ExportBundleButton({ kind, id, name, disabled = false }: ExportBundleButtonProps) {
  const [pending, setPending] = useState(false)
  const [fallbackJson, setFallbackJson] = useState<string | null>(null)

  async function startExport() {
    setPending(true)
    try {
      const text = kind === "profile" ? await exportProfileBundle(id) : await exportAutorunBundle(id)
      if (!downloadJson(`${kind}-${id}.json`, text)) setFallbackJson(text)
    } catch (error) {
      showToast(userMessageForError(error))
    } finally {
      setPending(false)
    }
  }

  async function copyFallback() {
    if (fallbackJson === null) return
    const copied = await copyText(fallbackJson)
    showToast(copied ? COPIED_MESSAGE : COPY_FAILED_MESSAGE, copied ? "info" : "error")
  }

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        icon={Download}
        iconSize="row"
        aria-label={pending ? `Exporting ${name}` : `Export ${name}`}
        title={pending ? `Exporting ${name}` : `Export ${name}`}
        aria-busy={pending}
        disabled={disabled || pending}
        data-testid={`${kind}-${id}-export`}
        onClick={() => void startExport()}
      >
        Export
      </Button>
      <span data-testid="export-status" role="status" aria-live="polite" className="sr-only">
        {pending ? `Exporting ${name}…` : ""}
      </span>

      <Dialog
        open={fallbackJson !== null}
        onClose={() => setFallbackJson(null)}
        title={EXPORT_FALLBACK_TITLE}
        footer={
          <>
            <Button variant="secondary" onClick={() => setFallbackJson(null)}>
              Close
            </Button>
            <Button variant="primary" onClick={() => void copyFallback()}>
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
            value={fallbackJson ?? ""}
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
    </>
  )
}
