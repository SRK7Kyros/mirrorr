import { z } from "zod"

/**
 * `ProbeResponse` — one source checked the way a run checks its own before the
 * engine starts. A failure is an answer: `ok` is false and `error` says why, the
 * HTTP call itself never fails for a dead stream.
 */
export const ProbeVerdictSchema = z.object({
  ok: z.boolean(),
  latency_ms: z.number(),
  error: z.string().nullable().optional(),
  source_url: z.string().nullable().optional(),
  checked_at: z.string().nullable().optional(),
})

export type ProbeVerdict = z.infer<typeof ProbeVerdictSchema>

/**
 * `ProbeLookupResponse` — the last verdict for each capture asked about, in the
 * same order, `null` for one that has never been probed.
 */
export const ProbeLookupSchema = z.object({
  items: z.array(ProbeVerdictSchema.nullable()),
})

export type ProbeLookup = z.infer<typeof ProbeLookupSchema>
