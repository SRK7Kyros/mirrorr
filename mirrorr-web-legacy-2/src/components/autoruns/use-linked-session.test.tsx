/**
 * V6 linked-session discovery (spec L279-L301, §13.3): the card reads the
 * shared sessions-list cache — the same `InfiniteData` key the entity store
 * applies `session.created` frames to — instead of a private plain-page query.
 */
import type { InfiniteData } from "@tanstack/react-query"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it } from "vitest"
import { findLinkedSession, useLinkedSession } from "@/components/autoruns/use-linked-session"
import { queryKeys } from "@/lib/query-keys"
import type { Autorun } from "@/lib/schemas/autoruns"
import type { CursorPage } from "@/lib/schemas/pagination"
import type { Session } from "@/lib/schemas/sessions"

function makeSession(overrides: Partial<Session> & { id: number }): Session {
  return { status: "recording", engine_id: 1, resolver_id: 1, ...overrides }
}

function makeAutorun(id: number): Autorun {
  return {
    id,
    user_friendly_name: "Nightly",
    snake_case_name: "nightly",
    engine_id: 1,
    resolver_id: 1,
    status: "scheduled",
    start_time: "2031-03-04T10:00:00",
    end_time: "2031-03-04T12:00:00",
  }
}

function infinite(items: readonly Session[]): InfiniteData<CursorPage<Session>, null> {
  return { pages: [{ items, next_cursor: null, has_more: false }], pageParams: [null] }
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe("findLinkedSession", () => {
  it("returns the newest session matching the autorun id", () => {
    const sessions = [
      makeSession({ id: 41, autorun_id: 7 }),
      makeSession({ id: 88, autorun_id: 7 }),
      makeSession({ id: 90, autorun_id: 9 }),
    ]

    expect(findLinkedSession(sessions, 7)?.id).toBe(88)
  })

  it("returns undefined without a match or without an autorun id", () => {
    expect(findLinkedSession([makeSession({ id: 1, autorun_id: 2 })], 3)).toBeUndefined()
    expect(findLinkedSession([makeSession({ id: 1, autorun_id: 2 })], undefined)).toBeUndefined()
  })
})

describe("useLinkedSession", () => {
  it("reads the shared sessions InfiniteData cache without refetching", () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnMount: false, refetchOnWindowFocus: false },
      },
    })
    client.setQueryData(
      queryKeys.sessions(),
      infinite([
        makeSession({ id: 87, autorun_id: 41 }),
        makeSession({ id: 88, autorun_id: 41 }),
      ]),
    )

    const { result } = renderHook(() => useLinkedSession(makeAutorun(41)), {
      wrapper: wrapperFor(client),
    })

    expect(result.current?.id).toBe(88)
  })
})
