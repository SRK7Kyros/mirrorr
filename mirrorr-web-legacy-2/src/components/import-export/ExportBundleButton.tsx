/**
 * Per-row export control — spec L331 (profiles), L295 (autoruns), L546/L614
 * (download mechanics), contract §9/§13.5.
 *
 * The export is an authenticated `apiFetchText` GET (never a token-bearing
 * link); the payload is validated inside `import-export-api`, then either handed
 * to the browser as a `.json` download or kept in the "Export ready — copy the
 * JSON" dialog when the environment cannot start a download. Failures surface
 * through `userMessageForError`.
 */
import { Download } from "lucide-react"
import { useState } from "react"
import { ExportFallbackDialog } from "@/components/import-export/ExportFallbackDialog"
import { Button } from "@/components/ui/Button"
import { userMessageForError } from "@/lib/errors"
import { exportBundleToFile } from "@/lib/export-bundle"
import { showToast } from "@/lib/toast"

export interface ExportBundleButtonProps {
  readonly kind: "profile" | "autorun"
  readonly id: number
  /** Row label, used for the accessible name and the toast copy. */
  readonly name: string
  readonly disabled?: boolean
}

export function ExportBundleButton({ kind, id, name, disabled = false }: ExportBundleButtonProps) {
  const [pending, setPending] = useState(false)
  const [fallbackJson, setFallbackJson] = useState<string | null>(null)

  async function startExport() {
    setPending(true)
    try {
      const outcome = await exportBundleToFile(kind, id)
      if (!outcome.downloaded) setFallbackJson(outcome.text)
    } catch (error) {
      showToast(userMessageForError(error))
    } finally {
      setPending(false)
    }
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

      <ExportFallbackDialog json={fallbackJson} onClose={() => setFallbackJson(null)} />
    </>
  )
}
