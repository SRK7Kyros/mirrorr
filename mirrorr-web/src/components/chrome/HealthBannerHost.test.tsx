/**
 * Todo 21 (spec L158, L171): exactly ONE offline banner exists at any time.
 * A user principal sees the 15s socket copy once; an API-client principal sees
 * its own banner and never the socket one.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiClientBanner } from "@/components/chrome/ApiClientBanner"
import { HealthBannerHost } from "@/components/chrome/HealthBannerHost"
import { HEALTH_BANNER_COPY } from "@/components/ui/HealthBanner"
import { clearAuthSession, setApiClientSession, setAuthSession } from "@/lib/auth-store"
import { resetRealtimeStatus, setRealtimeStatus } from "@/lib/realtime-status"
import { AUTH_BODY, installFetch, jsonResponse } from "@/test/api-helpers"

const OFFLINE_COPY = HEALTH_BANNER_COPY.socket

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

describe("HealthBannerHost socket banner", () => {
  it("renders the 15s copy exactly once for a user principal", () => {
    setAuthSession(AUTH_BODY)
    setRealtimeStatus("offline")
    renderChrome()

    expect(screen.getAllByText(OFFLINE_COPY)).toHaveLength(1)
    expect(screen.queryByTestId("api-client-banner")).toBeNull()
  })

  it("suppresses the socket banner for an API-client principal", () => {
    setApiClientSession({ id: 7, name: "ops-key" })
    setRealtimeStatus("offline")
    renderChrome()

    expect(screen.queryByText(OFFLINE_COPY)).toBeNull()
  })

  it("keeps the API-unreachable banner for a user principal when health fails", async () => {
    installFetch(async () => jsonResponse(503, { detail: "down" }))
    setAuthSession(AUTH_BODY)
    setRealtimeStatus("live")
    renderChrome()

    expect(await screen.findByText(HEALTH_BANNER_COPY.api)).toBeTruthy()
    expect(screen.queryByText(OFFLINE_COPY)).toBeNull()
  })
})
