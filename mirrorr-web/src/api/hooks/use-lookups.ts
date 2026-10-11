import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { queryKeys, staleTimes, fetchAllLookupPages } from "@/api/query-keys"
import { fetchAllEngines, fetchAllResolvers, fetchSourcePage, fetchProfilePage } from "@/api/endpoints"
import type { Engine, Profile, Resolver, ResolverSource } from "@/api/schemas"

/**
 * Lookup hooks — engines / resolvers / profiles are small, long-lived
 * reference tables. They are fetched once (lookup staleTime) and memoised into
 * `Map<id, name>` so list rows can resolve names without N+1 requests.
 */

const EMPTY: never[] = []

export function useEngines(): Engine[] {
  const query = useQuery({
    queryKey: queryKeys.engines,
    queryFn: () => fetchAllEngines(),
    staleTime: staleTimes.lookup,
  })
  return query.data ?? EMPTY
}

export function useResolvers(): Resolver[] {
  const query = useQuery({
    queryKey: queryKeys.resolvers,
    queryFn: () => fetchAllResolvers(),
    staleTime: staleTimes.lookup,
  })
  return query.data ?? EMPTY
}

function useProfilesLookup(): Profile[] {
  const query = useQuery({
    queryKey: queryKeys.profiles({ lookup: true }),
    queryFn: () => fetchAllLookupPages((cursor) => fetchProfilePage(cursor)),
    staleTime: staleTimes.lookup,
  })
  return query.data ?? EMPTY
}

export function useProfiles(): Profile[] {
  return useProfilesLookup()
}

export function useSources(): ResolverSource[] {
  const query = useQuery({
    queryKey: queryKeys.sources({ lookup: true }),
    queryFn: () => fetchAllLookupPages((cursor) => fetchSourcePage(cursor)),
    staleTime: staleTimes.lookup,
  })
  return query.data ?? EMPTY
}

export interface NameMaps {
  readonly engines: Map<number, string>
  readonly resolvers: Map<number, string>
  readonly profiles: Map<number, string>
}

export function useNameMaps(): NameMaps {
  const engines = useEngines()
  const resolvers = useResolvers()
  const profiles = useProfilesLookup()
  return useMemo(() => {
    const map = (items: ReadonlyArray<{ id: number; name: string }>) => {
      const next = new Map<number, string>()
      for (const item of items) next.set(item.id, item.name)
      return next
    }
    return { engines: map(engines), resolvers: map(resolvers), profiles: map(profiles) }
  }, [engines, resolvers, profiles])
}
