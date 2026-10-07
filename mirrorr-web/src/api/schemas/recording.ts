import { z } from "zod"

/** `RecordingResponse` — denormalized snapshot; name fields are guaranteed here. */
export const RecordingSchema = z
  .object({
    id: z.number(),
    user_friendly_name: z.string(),
    snake_case_name: z.string(),
    disk_path: z.string(),
    content_url: z.string(),
    profile_name: z.string(),
    engine_name: z.string(),
    resolver_name: z.string(),
    started_at: z.string(),
    ended_at: z.string(),
    duration_seconds: z.number(),
    size_bytes: z.number(),
    created_at: z.string(),
    session_id: z.number().nullable().optional(),
    media_served: z.boolean().optional(),
  })
  .passthrough()

export type Recording = z.infer<typeof RecordingSchema>
