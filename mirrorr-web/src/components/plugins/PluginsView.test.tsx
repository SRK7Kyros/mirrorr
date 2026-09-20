/**
 * V9 component tests — spec L303-L337 + L395 (read-only engine/resolver cards,
 * capability badges, copyable origin hashes, expandable schemas, the
 * "Plugins are discovered at server boot" footer, and no edit affordance).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { PluginsView } from "@/components/plugins/PluginsView"
import { ToastViewport } from "@/components/ui/Toast"
import { API_URL_ENV_VAR } from "@/config/env"
import { clearToasts, getToasts } from "@/lib/toast"
import { jsonResponse, installFetch } from "@/test/api-helpers"

const ENGINE_HASH = "6e57c6e8db68009974221b4e9971df4c96ddd0973df779b6cc8d7512972f096b"
const RESOLVER_HASH = "f1c23535bececa4fe11b0b6bb681f66f902b87f40018143efc825274964305b9"

const ENGINE = {
  id: 1,
  name: "yt_dlp_piped",
  description: "A wrapper around yt-dlp that pipes raw video to ffmpeg.",
  origin: "yt_dlp_piped",
  origin_hash: ENGINE_HASH,
  capabilities: { can_record: true, can_playlist: true },
  retry_modes_schema: {
    none: { schema: {}, default_params: {} },
    count: {
      schema: { type: "object", properties: { count: { type: "integer", default: 3, minimum: 1 } } },
      default_params: { count: 3 },
    },
  },
}

const FALLBACK_ENGINE = {
  id: 2,
  name: "noop_engine",
  description: "Records nothing.",
  origin: "noop",
  origin_hash: RESOLVER_HASH,
  capabilities: { can_record: false, can_playlist: false },
}

const RESOLVER = {
  id: 1,
  name: "static",
  description: "Static resolver that always serves the same url and headers.",
  origin: "static",
  origin_hash: RESOLVER_HASH,
  config_schema: {
    type: "object",
    title: "StaticConfig",
    properties: { url: { type: "string", title: "Url" } },
    required: ["url"],
  },
}

interface StubState {
  engines: unknown[]
  resolvers: unknown[]
  copied: string[]
}

function stubApi(state: StubState) {
  installFetch(async (url) => {
    if (url.startsWith("/api/engines/?")) {
      return jsonResponse(200, { items: state.engines, next_cursor: null, has_more: false })
    }
    if (url.startsWith("/api/resolvers/?")) {
      return jsonResponse(200, { items: state.resolvers, next_cursor: null, has_more: false })
    }
    return jsonResponse(404, { detail: `unexpected ${url}` })
  })
}

function renderView() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnMount: false, refetchOnWindowFocus: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <PluginsView />
      <ToastViewport />
    </QueryClientProvider>,
  )
}

async function renderLoaded(state: StubState) {
  stubApi(state)
  renderView()
  await screen.findByText("Engines")
  await screen.findByRole("heading", { name: "yt_dlp_piped" })
}

beforeEach(() => {
  vi.stubEnv(API_URL_ENV_VAR, "/api")
  clearToasts()
  vi.restoreAllMocks()
})

describe("PluginsView", () => {
  it("renders the engines and resolvers sections with cards", async () => {
    await renderLoaded({ engines: [ENGINE], resolvers: [RESOLVER], copied: [] })

    expect(screen.getByRole("heading", { name: "Engines" })).toBeDefined()
    expect(screen.getByRole("heading", { name: "Resolvers" })).toBeDefined()
    expect(screen.getByTestId("engine-card-1")).toBeDefined()
    expect(screen.getByTestId("resolver-card-1")).toBeDefined()
    expect(screen.getByText("A wrapper around yt-dlp that pipes raw video to ffmpeg.")).toBeDefined()
    expect(screen.getByText("Static resolver that always serves the same url and headers.")).toBeDefined()

    const engineCard = screen.getByTestId("engine-card-1")
    expect(within(engineCard).getByText(/6e57c6e8db68/)).toBeDefined()
  })

  it("badges recordable and playlist-capable engines and neutrals the rest", async () => {
    await renderLoaded({ engines: [ENGINE, FALLBACK_ENGINE], resolvers: [], copied: [] })

    const recordable = screen.getByTestId("engine-card-1")
    expect(within(recordable).getByText("Record")).toBeDefined()
    expect(within(recordable).getByText("Playlist")).toBeDefined()

    const fallback = screen.getByTestId("engine-card-2")
    expect(within(fallback).getByText("no record")).toBeDefined()
    expect(within(fallback).getByText("no playlist")).toBeDefined()
  })

  it("copies the full origin hash to the clipboard", async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    await renderLoaded({ engines: [ENGINE], resolvers: [RESOLVER], copied: [] })

    fireEvent.click(screen.getByRole("button", { name: "Copy origin hash for yt_dlp_piped" }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ENGINE_HASH))
    expect(getToasts().some((toast) => toast.message === "Origin hash copied")).toBe(true)
  })

  it("expands the engine retry modes and the resolver config schema", async () => {
    await renderLoaded({ engines: [ENGINE], resolvers: [RESOLVER], copied: [] })

    const engineCard = screen.getByTestId("engine-card-1")
    fireEvent.click(within(engineCard).getByText("Retry modes"))
    expect(within(engineCard).getByText("count")).toBeDefined()
    const retrySchema = within(engineCard).getByTestId("engine-retry-schema-count")
    expect(retrySchema.textContent).toContain('"count"')
    expect(retrySchema.className).toContain("font-mono")

    const resolverCard = screen.getByTestId("resolver-card-1")
    fireEvent.click(within(resolverCard).getByText("Config schema"))
    expect(within(resolverCard).getByTestId("resolver-config-schema").textContent).toContain('"url"')
  })

  it("shows the discovery footer and offers no edit affordance", async () => {
    await renderLoaded({ engines: [ENGINE], resolvers: [RESOLVER], copied: [] })

    expect(screen.getByText("Plugins are discovered at server boot")).toBeDefined()
    const view = screen.getByTestId("plugins-view")
    expect(within(view).queryByRole("button", { name: /edit|save|delete|remove|new/i })).toBeNull()
  })

  it("shows the no-engines empty state when the catalog is empty", async () => {
    stubApi({ engines: [], resolvers: [], copied: [] })
    renderView()

    await screen.findByText("No engines installed")
  })
})
