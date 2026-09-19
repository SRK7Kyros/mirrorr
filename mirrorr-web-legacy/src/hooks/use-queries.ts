/**
 * Shared TanStack Query hooks for entity fetching.
 * Eliminates the duplicated useQuery calls across route files.
 */
import { useQuery } from "@tanstack/react-query";
import {
	autorunsApi,
	pluginsApi,
	profilesApi,
	recordingsApi,
	sessionsApi,
} from "@/lib/api";

export const useSessions = () =>
	useQuery({
		queryKey: ["sessions"],
		queryFn: () => sessionsApi.list(),
		staleTime: 30_000,
		retry: 2,
	});

export const useAutoruns = () =>
	useQuery({
		queryKey: ["autoruns"],
		queryFn: () => autorunsApi.list(),
		staleTime: 30_000,
		retry: 2,
	});

export const useRecordings = () =>
	useQuery({
		queryKey: ["recordings"],
		queryFn: () => recordingsApi.list(),
		staleTime: 30_000,
		retry: 2,
	});

export const useProfiles = () =>
	useQuery({
		queryKey: ["profiles"],
		queryFn: () => profilesApi.list(),
		staleTime: 30_000,
		retry: 2,
	});

export const useEngines = () =>
	useQuery({
		queryKey: ["engines"],
		queryFn: () => pluginsApi.engines(),
		staleTime: 30_000,
		retry: 2,
	});

export const useResolvers = () =>
	useQuery({
		queryKey: ["resolvers"],
		queryFn: () => pluginsApi.resolvers(),
		staleTime: 30_000,
		retry: 2,
	});
