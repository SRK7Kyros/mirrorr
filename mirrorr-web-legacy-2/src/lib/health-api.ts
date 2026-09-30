/**
 * The liveness probe behind the health banner.
 *
 * Contract: `docs/general-client-specification.md` §12.5 and
 * `docs/web-frontend-spec.md` L407 — `GET /health` answers `{"status":"ok"}`;
 * when it is unreachable the top banner reads "API unreachable — retrying".
 */
import { z } from "zod"
import { apiFetch } from "@/lib/api"

export const healthSchema = z.object({ status: z.string() })

export type HealthStatus = z.infer<typeof healthSchema>

export function fetchHealth(signal?: AbortSignal): Promise<HealthStatus> {
  return apiFetch<HealthStatus>("/health", { schema: healthSchema, signal })
}
