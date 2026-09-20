/**
 * Recording payload shape.
 *
 * Contract: `docs/general-client-specification.md` §6 —
 * `{id, user_friendly_name, snake_case_name, disk_path, content_url,
 * profile_name, engine_name, resolver_name, started_at, ended_at,
 * duration_seconds, size_bytes, created_at}`. `passthrough` because the server
 * may add the §13.12.2 enrichment (`media_served`, `session_id`) —
 * `media_served` is NOT a current guarantee and the client must not rely on it.
 */
import { z } from "zod"

export const recordingSchema = z
  .object({
    id: z.number().int(),
    user_friendly_name: z.string(),
    snake_case_name: z.string().optional(),
    disk_path: z.string().optional(),
    content_url: z.string().nullable().optional(),
    profile_name: z.string().nullable().optional(),
    engine_name: z.string().nullable().optional(),
    resolver_name: z.string().nullable().optional(),
    started_at: z.string().nullable().optional(),
    ended_at: z.string().nullable().optional(),
    duration_seconds: z.number().nullable().optional(),
    size_bytes: z.number().nullable().optional(),
    created_at: z.string().nullable().optional(),
  })
  .passthrough()

export type Recording = z.infer<typeof recordingSchema>

/** True when the recording has a usable link-out URL (never embed). */
export function recordingHasMedia(recording: Recording): boolean {
  return typeof recording.content_url === "string" && recording.content_url.trim().length > 0
}
