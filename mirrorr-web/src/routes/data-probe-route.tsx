import { createRoute } from "@tanstack/react-router"
import { DataProbe } from "@/components/dev/DataProbe"
import { MergeProbe } from "@/components/dev/MergeProbe"
import { authLayoutRoute } from "@/routes/auth-layout-route"

/**
 * TEMPORARY dev route for the data-layer probe (removed with the probe in
 * Wave 2). It exists so the Playwright data-layer specs can exercise the real
 * hooks before the operator views land.
 */
export const dataProbeRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/dev/data-probe",
  component: DataProbePage,
})

function DataProbePage() {
  return (
    <main className="min-h-dvh bg-bg-base p-6">
      <DataProbe />
      <MergeProbe />
    </main>
  )
}
