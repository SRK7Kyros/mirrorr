import { useQuery } from "@tanstack/react-query"
import { fetchAllEngines, fetchAllResolvers, fetchProfilePage } from "@/api/endpoints"
import { fetchAllLookupPages, queryKeys, staleTimes } from "@/api/query-keys"
import type { Engine, Profile, Resolver } from "@/api/schemas"

/**
 * A lookup table **and its query state**.
 *
 * `useProfiles` / `useEngines` / `useResolvers` answer `data ?? []`, which is
 * exactly the shape that lets a failed request render as "none available" — the
 * dialog then shows an empty picker and a disabled primary with no reason (the
 * defect `FLW-01` and `CMP-08` name). The new-session dialog has to tell
 * loading from empty from failed, so it reads the same query keys with the same
 * fetchers here: TanStack dedupes by key, so this costs no extra request, and
 * the cache stays shared with every other reader of the lookup tables.
 */
export interface Catalog<T> {
  readonly items: readonly T[]
  readonly isLoading: boolean
  readonly isError: boolean
  readonly error: unknown
  readonly refetch: () => void
}

export interface NewSessionCatalogs {
  readonly profiles: Catalog<Profile>
  readonly engines: Catalog<Engine>
  readonly resolvers: Catalog<Resolver>
}

interface QueryLike<T> {
  readonly data: readonly T[] | undefined
  readonly isLoading: boolean
  readonly isError: boolean
  readonly error: unknown
  readonly refetch: () => unknown
}

function catalogOf<T>(query: QueryLike<T>): Catalog<T> {
  return {
    items: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: () => {
      void query.refetch()
    },
  }
}

/** The three catalogs the dialog picks from, each with loading / error / empty. */
export function useNewSessionCatalogs(): NewSessionCatalogs {
  const profiles = useQuery({
    queryKey: queryKeys.profiles({ lookup: true }),
    queryFn: () => fetchAllLookupPages((cursor) => fetchProfilePage(cursor)),
    staleTime: staleTimes.lookup,
  })
  const engines = useQuery({
    queryKey: queryKeys.engines,
    queryFn: () => fetchAllEngines(),
    staleTime: staleTimes.lookup,
  })
  const resolvers = useQuery({
    queryKey: queryKeys.resolvers,
    queryFn: () => fetchAllResolvers(),
    staleTime: staleTimes.lookup,
  })

  return {
    profiles: catalogOf(profiles),
    engines: catalogOf(engines),
    resolvers: catalogOf(resolvers),
  }
}
