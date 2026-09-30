/**
 * `/import-export` — the import wizard + export explainer (spec L45, L347-L362).
 *
 * Export itself is NOT here: it lives as row actions on Profiles/Autoruns
 * (todo 23). This route explains where export lives and hosts the wizard.
 */
import { ImportWizard } from "@/components/import-export/ImportWizard"

export const EXPORT_EXPLAINER_HEADING = "Exporting"
export const EXPORT_EXPLAINER_CLAIMS = [
  "Export is per-row — use the Export action on a profile or autorun row.",
  "Each bundle downloads as a .json file from your browser.",
  "There is no bulk export — the API only serves single-entity bundles.",
] as const

export function ImportExportView() {
  return (
    <main data-testid="import-export-view" className="flex flex-col gap-6">
      <h1 className="text-title font-semibold text-text-primary">Import / Export</h1>

      <section
        data-testid="export-explainer"
        aria-labelledby="export-explainer-heading"
        className="flex flex-col gap-2 rounded-surface border border-border bg-bg-raised p-4"
      >
        <h2 id="export-explainer-heading" className="text-heading font-medium text-text-primary">
          {EXPORT_EXPLAINER_HEADING}
        </h2>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-body text-text-secondary">
          {EXPORT_EXPLAINER_CLAIMS.map((claim) => (
            <li key={claim}>{claim}</li>
          ))}
        </ul>
      </section>

      <ImportWizard />
    </main>
  )
}
