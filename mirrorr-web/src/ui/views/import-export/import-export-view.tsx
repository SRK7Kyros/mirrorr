import { Page } from "@/ui/views/shared/page"
import { ExportPanel } from "./export-panel"
import { ImportWizard } from "./import-wizard"

export function ImportExportView() {
  return (
    <Page
      title="Import / Export"
      description="Move profiles and autoruns between Mirrorr instances as versioned JSON bundles."
    >
      <ImportWizard />
      <ExportPanel />
    </Page>
  )
}
