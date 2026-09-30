/**
 * Import/export endpoints — client contract §9/§13.5.
 *
 * `POST /import-export/validate` takes the RAW bundle object as its body;
 * `POST /import-export/apply` takes the wizard's encoded payload. The
 * per-entity exports are authenticated GETs returning the v1 bundle as text,
 * validated here against `bundleSchema` so callers only ever see version-1
 * payloads. All of it reuses the shared `apiFetch` transport (auth, refresh,
 * error normalization).
 */
import { apiFetch, apiFetchText } from "@/lib/api"
import { ApiParseError } from "@/lib/errors"
import {
  applyResponseSchema,
  bundleSchema,
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

/**
 * `GET /import-export/profiles/{id}/export` — one profile bundle as raw JSON
 * text (auth + owner enforced server-side).
 */
export async function exportProfileBundle(id: number): Promise<string> {
  return parseExportBundle(await apiFetchText(`/import-export/profiles/${id}/export`))
}

/**
 * `GET /import-export/autoruns/{id}/export` — one autorun bundle with the
 * embedded profile inline (client spec §9).
 */
export async function exportAutorunBundle(id: number): Promise<string> {
  return parseExportBundle(await apiFetchText(`/import-export/autoruns/${id}/export`))
}

/**
 * The download contract is the v1 bundle (client spec §9): a body that does
 * not parse as JSON, does not match `bundleSchema`, or is not version 1 is a
 * parse failure, exactly like a schema-mismatched `apiFetch` response
 * (`ApiParseError` → "Unexpected server response").
 */
function parseExportBundle(text: string): string {
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new ApiParseError(200)
  }
  const parsed = bundleSchema.safeParse(payload)
  if (!parsed.success || parsed.data.version !== 1) throw new ApiParseError(200)
  return text
}
