/**
 * Recording endpoints.
 *
 * Contract: `docs/general-client-specification.md` §6 — `GET /recordings/`
 * (paginated) and `DELETE /recordings/{id}` (204, removes file + row, emits
 * `recording.deleted`). There is no POST/PUT: recordings are produced by the
 * remux finalize.
 */
import { apiFetch } from "@/lib/api"
import { recordingSchema, type Recording } from "@/lib/schemas/recordings"
import { cursorPageSchema, type CursorPage } from "@/lib/schemas/pagination"

/** Structurally identical to `InfinitePageRequest` (`src/hooks/use-infinite-list.ts`). */
export interface RecordingPageRequest {
  readonly cursor: number | null
  readonly limit: number
  readonly signal: AbortSignal
}

function pageQuery(cursor: number | null, limit: number): string {
  const params = new URLSearchParams({ limit: String(limit) })
  if (cursor !== null) params.set("cursor", String(cursor))
  return params.toString()
}

export function fetchRecordingsPage(request: RecordingPageRequest): Promise<CursorPage<Recording>> {
  return apiFetch<CursorPage<Recording>>(`/recordings/?${pageQuery(request.cursor, request.limit)}`, {
    schema: cursorPageSchema(recordingSchema),
    signal: request.signal,
  })
}

export function deleteRecording(id: number): Promise<void> {
  return apiFetch(`/recordings/${id}`, { method: "DELETE" })
}
