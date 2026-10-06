import { QueryClient } from "@tanstack/react-query"

// Brief IMPROVEMENT #2: QueryClient defaults are set once here (retry,
// staleTime, refetchOnWindowFocus); polling-policy still overrides lists.
const QUERY_RETRY_COUNT = 1
const LIST_STALE_TIME_MS = 30_000

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: QUERY_RETRY_COUNT,
      staleTime: LIST_STALE_TIME_MS,
      refetchOnWindowFocus: false,
    },
  },
})
