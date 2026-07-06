/**
 * Shared TanStack Query hooks for entity fetching.
 * Eliminates the duplicated useQuery calls across route files.
 */
import { useQuery } from "@tanstack/react-query"
import {
  sessionsApi,
  autorunsApi,
  recordingsApi,
  profilesApi,
  pluginsApi,
} from "@/lib/api"

export const useSessions = () =>
  useQuery({ queryKey: ["sessions"], queryFn: () => sessionsApi.list() })

export const useAutoruns = () =>
  useQuery({ queryKey: ["autoruns"], queryFn: () => autorunsApi.list() })

export const useRecordings = () =>
  useQuery({ queryKey: ["recordings"], queryFn: () => recordingsApi.list() })

export const useProfiles = () =>
  useQuery({ queryKey: ["profiles"], queryFn: () => profilesApi.list() })

export const useEngines = () =>
  useQuery({ queryKey: ["engines"], queryFn: () => pluginsApi.engines() })

export const useResolvers = () =>
  useQuery({ queryKey: ["resolvers"], queryFn: () => pluginsApi.resolvers() })
