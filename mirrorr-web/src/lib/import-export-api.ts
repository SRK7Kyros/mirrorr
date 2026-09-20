/**
 * Import/export endpoints — client contract §9/§13.5.
 *
 * `POST /import-export/validate` takes the RAW bundle object as its body;
 * `POST /import-export/apply` takes the wizard's encoded payload. Both reuse
 * the shared `apiFetch` transport (auth, refresh, error normalization).
 */
import { apiFetch } from "@/lib/api"
import {
  applyResponseSchema,
  validateReportSchema,
  type ApplyBody,
  type ApplyResponse,
  type Bundle,
  type ValidateReport,
} from "@/lib/schemas/import-export"

export function validateBundle(bundle: Bundle): Promise<ValidateReport> {
  return apiFetch<ValidateReport>("/import-export/validate", {
    method: "POST",
    body: bundle,
    schema: validateReportSchema,
  })
}

export function applyBundle(body: ApplyBody): Promise<ApplyResponse> {
  return apiFetch<ApplyResponse>("/import-export/apply", {
    method: "POST",
    body,
    schema: applyResponseSchema,
  })
}
