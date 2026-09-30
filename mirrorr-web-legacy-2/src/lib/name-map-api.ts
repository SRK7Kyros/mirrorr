/**
 * The app-level name-map store, wired to the real API.
 *
 * One all-pages fetch per collection (`limit=200`, following `next_cursor`
 * while `has_more` — `docs/web-frontend-spec.md` L132-L133), memoized by the
 * store so a session/autorun list resolves every `engine_id`/`resolver_id`/
 * `profile_id` from three requests total (`docs/general-client-specification.md`
 * §13.13).
 */
import { z } from "zod"
import { apiFetch } from "@/lib/api"
import { createNameMapStore, type NameMapEntity, type NameMapKind } from "@/lib/name-map"
import { PAGE_LIMIT_PLUGINS, fetchAllPages } from "@/lib/pagination"
import { cursorPageSchema } from "@/lib/schemas/pagination"

const namedEntitySchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
  })
  .passthrough()

const KIND_PATHS: Record<NameMapKind, string> = {
  engine: "/engines/",
  resolver: "/resolvers/",
  profile: "/profiles/",
}

/** Module-level singleton, like `src/query-client.ts`. */
export const nameMapStore = createNameMapStore((kind) =>
  fetchAllPages<NameMapEntity>(
    async ({ cursor, limit }) => {
      const params = new URLSearchParams({ limit: String(limit) })
      if (cursor !== null) params.set("cursor", String(cursor))
      return apiFetch(`${KIND_PATHS[kind]}?${params.toString()}`, { schema: cursorPageSchema(namedEntitySchema) })
    },
    { limit: PAGE_LIMIT_PLUGINS },
  ),
)
