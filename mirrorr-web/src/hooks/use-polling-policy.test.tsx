/**
 * Todo 21 acceptance: the hook binds the pure interval selection to the live
 * auth + realtime stores, the backstop switches cadence without a remount, and
 * the mounted 30s backstop does not fight WS cache updates — one interval
 * fetch per window, and a frame patch never adds a duplicate fetch.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { act } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useInfiniteList, type InfinitePageRequest } from "@/hooks/use-infinite-list"
import { usePollingPolicy } from "@/hooks/use-polling-policy"
import { clearAuthSession, setApiClientSession, setAuthSession } from "@/lib/auth-store"
import { queryKeys } from "@/lib/query-keys"
import { resetRealtimeStatus, setRealtimeStatus } from "@/lib/realtime-status"
import { AUTH_BODY } from "@/test/api-helpers"
import type { CursorPage } from "@/lib/schemas/pagination"

interface Row {
  readonly id: number
}

function createFetchPage() {
  let count = 0
  const fetchPage = async (): Promise<CursorPage<Row>> => {
    count += 1
    return { items: [], next_cursor: null, has_more: false }
  }
  return { fetchPage, getCount: () => count }
}

function Harness({
  fetchPage,
}: {
  readonly fetchPage: (request: InfinitePageRequest) => Promise<CursorPage<Row>>
}) {
  const polling = usePollingPolicy("list")
  useInfiniteList<Row>({
    queryKey: queryKeys.sessions(),
    fetchPage,
    refetchInterval: polling.refetchInterval,
    refetchOnWindowFocus: polling.refetchOnWindowFocus,
  })
  return <span data-testid="policy-interval">{String(polling.refetchInterval)}</span>
}

function renderHarness(fetchPage: HarnessProps["fetchPage"]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnMount: false, refetchOnWindowFocus: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <Harness fetchPage={fetchPage} />
    </QueryClientProvider>,
  )
  return client
}

type HarnessProps = { readonly fetchPage: Parameters<typeof Harness>[0]["fetchPage"] }

afterEach(() => {
  clearAuthSession()
  resetRealtimeStatus()
  vi.useRealTimers()
})

describe("usePollingPolicy", () => {
  it("binds the selected interval to principal type and realtime state", () => {
    setAuthSession(AUTH_BODY)
    setRealtimeStatus("live")
    renderHarness(createFetchPage().fetchPage)
    expect(screen.getByTestId("policy-interval").textContent).toBe("30000")

    act(() => setRealtimeStatus("offline"))
    expect(screen.getByTestId("policy-interval").textContent).toBe("15000")

    act(() => setApiClientSession({ id: 7, name: "ops-key" }))
    expect(screen.getByTestId("policy-interval").textContent).toBe("10000")
  })
})

describe("30s backstop vs realtime updates", () => {
  it("fetches once per backstop window and a WS cache patch adds no duplicate fetch", async () => {
    setAuthSession(AUTH_BODY)
    setRealtimeStatus("live")
    vi.useFakeTimers()
    const { fetchPage, getCount } = createFetchPage()
    const client = renderHarness(fetchPage)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(getCount()).toBe(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(getCount()).toBe(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(getCount()).toBe(2)

    await act(async () => {
      client.setQueryData(queryKeys.sessions(), {
        pages: [{ items: [{ id: 501 }], next_cursor: null, has_more: false }],
        pageParams: [null],
      })
      await vi.advanceTimersByTimeAsync(29_999)
    })
    expect(getCount()).toBe(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(getCount()).toBe(3)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(getCount()).toBe(4)
  })

  it("switches to the 15s fallback when the manager goes offline", async () => {
    setAuthSession(AUTH_BODY)
    setRealtimeStatus("live")
    vi.useFakeTimers()
    const { fetchPage, getCount } = createFetchPage()
    renderHarness(fetchPage)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(getCount()).toBe(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(getCount()).toBe(2)

    act(() => setRealtimeStatus("offline"))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_999)
    })
    expect(getCount()).toBe(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(getCount()).toBe(3)
  })
})
