/**
 * `/import-export` view test — the export explainer (spec L45, L643).
 *
 * The route owns NO export affordance: export is a row action on
 * Profiles/Autoruns (todo 23). The explainer states that, where the bundle
 * downloads, and why there is no bulk export.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  EXPORT_EXPLAINER_CLAIMS,
  EXPORT_EXPLAINER_HEADING,
  ImportExportView,
} from "@/components/import-export/ImportExportView"
import { API_URL_ENV_VAR } from "@/config/env"
import { installFetch, jsonResponse } from "@/test/api-helpers"

function renderView() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnMount: false, refetchOnWindowFocus: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ImportExportView />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.stubEnv(API_URL_ENV_VAR, "/api")
  installFetch(async (url) => {
    if (url.startsWith("/api/engines/?")) return jsonResponse(200, { items: [], next_cursor: null, has_more: false })
    if (url.startsWith("/api/resolvers/?")) return jsonResponse(200, { items: [], next_cursor: null, has_more: false })
    if (url.startsWith("/api/profiles/?")) return jsonResponse(200, { items: [], next_cursor: null, has_more: false })
    return jsonResponse(404, { detail: `unexpected ${url}` })
  })
})

describe("ImportExportView", () => {
  it("renders the export explainer with all three claims", () => {
    renderView()

    const explainer = screen.getByTestId("export-explainer")
    expect(within(explainer).getByRole("heading", { name: EXPORT_EXPLAINER_HEADING })).toBeDefined()
    expect(within(explainer).getByText(EXPORT_EXPLAINER_CLAIMS[0])).toBeDefined()
    expect(within(explainer).getByText(EXPORT_EXPLAINER_CLAIMS[1])).toBeDefined()
    expect(within(explainer).getByText(EXPORT_EXPLAINER_CLAIMS[2])).toBeDefined()
    expect(EXPORT_EXPLAINER_CLAIMS[0]).toContain("per-row")
    expect(EXPORT_EXPLAINER_CLAIMS[1]).toContain("downloads as a .json")
    expect(EXPORT_EXPLAINER_CLAIMS[2]).toContain("no bulk export")
  })

  it("hosts the wizard and offers no export button on this route", () => {
    renderView()

    expect(screen.getByTestId("import-export-view")).toBeDefined()
    expect(screen.getByTestId("import-wizard")).toBeDefined()
    expect(screen.queryByRole("button", { name: /export/i })).toBeNull()
  })
})
