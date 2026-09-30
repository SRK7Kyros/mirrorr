/**
 * D1 end-to-end form behaviour (spec L399-L401, L403): profile selection
 * prefills and submits the short body; any edit switches to the full explicit
 * body; the recording switch stays visible but disabled with the "Engine
 * cannot record" tooltip when the engine capability is false; server 422 `loc`
 * paths land inline.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { NewSessionDialog } from "@/components/sessions/NewSessionDialog"
import { API_URL_ENV_VAR } from "@/config/env"
import { installFetch, jsonResponse } from "@/test/api-helpers"

const CATALOG_EMPTY = { items: [], next_cursor: null, has_more: false }

function enginePayload(canRecord: boolean) {
  return {
    items: [
      {
        id: 1,
        name: "yt_dlp_piped",
        capabilities: { can_record: canRecord },
        retry_modes_schema: {
          none: { default_params: {} },
          count: { default_params: { count: 3, delay: 5 } },
        },
      },
    ],
    next_cursor: null,
    has_more: false,
  }
}

const RESOLVER_PAYLOAD = {
  items: [
    {
      id: 1,
      name: "static",
      config_schema: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
    },
  ],
  next_cursor: null,
  has_more: false,
}

const PROFILE_PAYLOAD = {
  items: [
    {
      id: 9,
      name: "p2",
      default_engine_id: 1,
      resolver_id: 1,
      resolver_config: { url: "https://example.com/original.m3u8" },
      retry_mode: "none",
      retry_config: {},
    },
  ],
  next_cursor: null,
  has_more: false,
}

const assignMock = vi.fn()
const originalLocation = window.location

beforeAll(() => {
  Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, assign: assignMock } })
})

afterAll(() => {
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation })
})

beforeEach(() => {
  vi.stubEnv(API_URL_ENV_VAR, "/api")
  assignMock.mockClear()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

interface StartOptions {
  readonly canRecord?: boolean
  readonly createResponse?: () => Response
}

function startDialog(options: StartOptions = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const posts: Array<Record<string, unknown>> = []
  const onClose = vi.fn()

  installFetch(async (url, init) => {
    const path = new URL(url, "http://localhost").pathname
    if (init?.method === "POST" && path.endsWith("/sessions/")) {
      posts.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      if (options.createResponse !== undefined) return options.createResponse()
      return jsonResponse(201, {
        id: 55,
        status: "active",
        engine_id: 1,
        resolver_id: 1,
        recording: false,
      })
    }
    if (path.endsWith("/engines/")) return jsonResponse(200, enginePayload(options.canRecord ?? true))
    if (path.endsWith("/resolvers/")) return jsonResponse(200, RESOLVER_PAYLOAD)
    if (path.endsWith("/profiles/")) return jsonResponse(200, PROFILE_PAYLOAD)
    return jsonResponse(200, CATALOG_EMPTY)
  })

  render(
    <QueryClientProvider client={client}>
      <NewSessionDialog open onClose={onClose} />
    </QueryClientProvider>,
  )

  return { posts, onClose }
}

describe("NewSessionDialog", () => {
  it("submits {profile_id, recording} for an unedited profile selection and navigates to the session", async () => {
    const { posts, onClose } = startDialog()
    fireEvent.click(screen.getByRole("button", { name: "From profile" }))
    const profile = await screen.findByRole("option", { name: "p2" })

    fireEvent.change(screen.getByLabelText("Profile"), { target: { value: (profile as HTMLOptionElement).value } })
    fireEvent.click(screen.getByRole("button", { name: "Start session" }))

    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toEqual({ profile_id: 9, recording: false })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(assignMock).toHaveBeenCalledWith("/sessions/55")
  })

  it("submits the full explicit form from the custom flow", async () => {
    const { posts } = startDialog()

    fireEvent.click(screen.getByRole("button", { name: "Custom" }))
    const engineOption = await screen.findByRole("option", { name: "yt_dlp_piped" })
    fireEvent.change(screen.getByLabelText("Engine"), { target: { value: (engineOption as HTMLOptionElement).value } })
    const resolverOption = await screen.findByRole("option", { name: "static" })
    fireEvent.change(screen.getByLabelText("Resolver"), {
      target: { value: (resolverOption as HTMLOptionElement).value },
    })

    fireEvent.change(await screen.findByLabelText(/Url/), {
      target: { value: "https://example.com/live.m3u8" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Start session" }))

    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toEqual({
      engine_id: 1,
      resolver_id: 1,
      resolver_config: { url: "https://example.com/live.m3u8" },
      retry_mode: "none",
      retry_config: {},
      recording: false,
    })
  })

  it("tracks edits per field: editing a prefilled profile value submits the full explicit form", async () => {
    const { posts } = startDialog()
    fireEvent.click(screen.getByRole("button", { name: "From profile" }))
    const profile = await screen.findByRole("option", { name: "p2" })

    fireEvent.change(screen.getByLabelText("Profile"), { target: { value: (profile as HTMLOptionElement).value } })
    fireEvent.change(await screen.findByLabelText(/Url/), {
      target: { value: "https://example.com/edited.m3u8" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Start session" }))

    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toEqual({
      engine_id: 1,
      resolver_id: 1,
      resolver_config: { url: "https://example.com/edited.m3u8" },
      retry_mode: "none",
      retry_config: {},
      recording: false,
    })
  })

  it("keeps the recording switch visible but disabled when can_record is false", async () => {
    startDialog({ canRecord: false })

    fireEvent.click(screen.getByRole("button", { name: "Custom" }))
    const engineOption = await screen.findByRole("option", { name: "yt_dlp_piped" })
    fireEvent.change(screen.getByLabelText("Engine"), { target: { value: (engineOption as HTMLOptionElement).value } })

    const toggle = await screen.findByRole("switch")
    expect(toggle.hasAttribute("disabled")).toBe(true)
    expect(toggle.getAttribute("title")).toBe("Engine cannot record")
    expect(screen.getByText("Recording")).toBeTruthy()
  })

  it("renders a server 422 loc path inline on the matching field", async () => {
    startDialog({
      createResponse: () =>
        jsonResponse(422, {
          detail: [{ loc: ["body", "resolver_config", "url"], msg: "Field required" }],
        }),
    })

    fireEvent.click(screen.getByRole("button", { name: "Custom" }))
    const engineOption = await screen.findByRole("option", { name: "yt_dlp_piped" })
    fireEvent.change(screen.getByLabelText("Engine"), { target: { value: (engineOption as HTMLOptionElement).value } })
    const resolverOption = await screen.findByRole("option", { name: "static" })
    fireEvent.change(screen.getByLabelText("Resolver"), {
      target: { value: (resolverOption as HTMLOptionElement).value },
    })
    fireEvent.change(await screen.findByLabelText(/Url/), { target: { value: "https://example.com/live.m3u8" } })
    fireEvent.click(screen.getByRole("button", { name: "Start session" }))

    expect(await screen.findByText("Field required")).toBeTruthy()
  })
})
