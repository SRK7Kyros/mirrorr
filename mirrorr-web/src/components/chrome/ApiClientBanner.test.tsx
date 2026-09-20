/**
 * Todo 21 (spec L158, L647): the persistent API-client banner. It renders for
 * the API-key principal only and carries the exact spec copy with the
 * principal's real name (never re-derived in the view).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiClientBanner, apiClientBannerText } from "@/components/chrome/ApiClientBanner"
import { HealthBannerHost } from "@/components/chrome/HealthBannerHost"
import { clearAuthSession, setApiClientSession, setAuthSession } from "@/lib/auth-store"
import { resetRealtimeStatus, setRealtimeStatus } from "@/lib/realtime-status"
import { AUTH_BODY, installFetch, jsonResponse } from "@/test/api-helpers"

function renderChrome() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <HealthBannerHost />
      <ApiClientBanner />
    </QueryClientProvider>,
  )
  return client
}

beforeEach(() => {
  installFetch(async (url) =>
    url.endsWith("/health") ? jsonResponse(200, { status: "ok" }) : jsonResponse(404, {}),
  )
})

afterEach(() => {
  clearAuthSession()
  resetRealtimeStatus()
  vi.unstubAllGlobals()
})

describe("ApiClientBanner", () => {
  it("renders the exact spec copy with the principal's name", () => {
    setApiClientSession({ id: 7, name: "ops-key" })
    renderChrome()

    expect(screen.getByTestId("api-client-banner").textContent).toBe(
      "Acting as API client 'ops-key' — created resources belong to no user and produce no notifications",
    )
  })

  it("updates the name when a different API client becomes the principal", () => {
    setApiClientSession({ id: 7, name: "ops-key" })
    renderChrome()
    act(() => setAuthSession({ user: null, client: { id: 8, name: "night-batch" } }))

    expect(screen.getByTestId("api-client-banner").textContent).toBe(apiClientBannerText("night-batch"))
  })

  it("stays absent for a user principal", () => {
    setAuthSession(AUTH_BODY)
    renderChrome()

    expect(screen.queryByTestId("api-client-banner")).toBeNull()
  })

  it("is the only offline banner for an API client (socket banner suppressed)", async () => {
    setApiClientSession({ id: 7, name: "ops-key" })
    setRealtimeStatus("offline")
    renderChrome()

    await waitFor(() =>
      expect(screen.getByText(apiClientBannerText("ops-key"))).toBeTruthy(),
    )
    expect(screen.queryByText("Live updates offline — polling every 15s")).toBeNull()
  })
})
