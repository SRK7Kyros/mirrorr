import { z } from "zod";

/**
 * `OverviewResponse` — the console's ops numbers in one round trip: what the
 * sessions list is doing, what the recordings cost on disk, and which schedule
 * fires next. Every count is already scoped to the caller by the server, so a
 * strip can never describe a row its reader may not open.
 */
export const OverviewSchema = z
  .object({
    sessions: z.object({
      running: z.number(),
      live: z.number(),
      starting: z.number(),
      finishing: z.number(),
      failed_24h: z.number(),
      total: z.number(),
    }),
    recordings: z.object({
      count: z.number(),
      size_bytes: z.number(),
      seconds: z.number(),
    }),
    disk: z
      .object({ total_bytes: z.number(), free_bytes: z.number() })
      .nullable()
      .optional(),
    next_autorun: z
      .object({
        id: z.number(),
        name: z.string(),
        starts_at: z.string(),
        status: z.string(),
      })
      .nullable()
      .optional(),
  })
  .passthrough();

export type Overview = z.infer<typeof OverviewSchema>;
