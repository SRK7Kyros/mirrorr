import { QueryClientProvider } from "@tanstack/react-query"
import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
} from "@tanstack/react-router"
import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { API_URL_ENV_VAR } from "@/config/env"
import { queryKeys } from "@/lib/query-keys"
import { queryClient } from "@/query-client"
import { routeTree } from "@/router"
import { AUTH_BODY, installFetch, jsonResponse } from "@/test/api-helpers"

const EMPTY_PAGE = { items: [], next_cursor: null, has_more: false }

describe("mirrorr-web app smoke", () => {
  beforeEach(() => {
    vi.stubEnv(API_URL_ENV_VAR, "/api")
    queryClient.clear()
    installFetch(async () => jsonResponse(200, EMPTY_PAGE))
  })

  afterEach(() => {
    queryClient.clear()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("renders the authenticated landing through the real router tree and providers", async () => {
    expect.assertions(3)

    queryClient.setQueryData(queryKeys.authMe(), AUTH_BODY)

    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/"] }),
    })

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    expect(await screen.findByTestId("sessions-view")).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Sessions" })).toBeTruthy()
    expect(screen.getByRole("main")).toBeTruthy()
  })
})
