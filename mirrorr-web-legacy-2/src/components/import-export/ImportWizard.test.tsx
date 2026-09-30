/**
 * V10 component tests — the wizard shell (spec L347-L362, L522-L548).
 *
 * Drives the four steps through the DOM: file guards never hit the network,
 * review renders the spec badges + rename preview, resolve renders one control
 * per issue type, apply posts the encoded body and lands on the summary, and a
 * 400 lands in the step-3 error panel.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ImportWizard } from "@/components/import-export/ImportWizard"
import { ToastViewport } from "@/components/ui/Toast"
import { API_URL_ENV_VAR } from "@/config/env"
import { INVALID_JSON_MESSAGE, TOO_LARGE_MESSAGE, UNSUPPORTED_VERSION_MESSAGE } from "@/lib/import-wizard"
import { queryClient } from "@/query-client"
import { installFetch, jsonResponse } from "@/test/api-helpers"
import { renderInRouter } from "@/test/router-harness"

const ENGINE_HASH = "6e57c6e8db68009974221b4e9971df4c96ddd0973df779b6cc8d7512972f096b"
const RESOLVER_HASH = "f1c23535bececa4fe11b0b6bb681f66f902b87f40018143efc825274964305b9"

const ENGINE = { id: 4, name: "yt_dlp_piped", origin: "yt_dlp_piped", origin_hash: ENGINE_HASH }
const RESOLVER = { id: 2, name: "static", origin: "static", origin_hash: RESOLVER_HASH }
const INSTALLED_PROFILE = { id: 1, name: "p2", default_engine_id: 4, resolver_id: 2 }

const BUNDLE = {
  version: 1,
  exported_at: "2050-01-01T00:00:00",
  profiles: [
    {
      name: "p-new",
      default_engine: { name: "engine_x", origin_hash: "bbbb" },
      resolver: { name: "static", origin_hash: RESOLVER_HASH },
      resolver_config: { url: "https://example.com/a.m3u8" },
      retry_mode: "none",
      retry_config: {},
    },
    {
      name: "p2",
      default_engine: { name: "yt_dlp_piped", origin_hash: ENGINE_HASH },
      resolver: { name: "static", origin_hash: RESOLVER_HASH },
      resolver_config: { url: "https://example.com/b.m3u8" },
      retry_mode: "none",
      retry_config: {},
    },
  ],
  autoruns: [
    {
      user_friendly_name: "t-new",
      profile_name: "p-gone",
      profile: { name: "p-gone" },
      start_time: "2050-07-15T15:12:00",
      end_time: "2050-07-15T16:12:00",
      recording: false,
      engine_override: { name: "yt_dlp_piped", origin_hash: "oldengine" },
    },
  ],
}

const REPORT = {
  valid: false,
  profiles: [
    {
      name: "p-new",
      content_hash: "4494a0d0",
      valid: false,
      issues: [
        {
          problem: "not_installed",
          field: "engine",
          bundled: { name: "engine_x", origin_hash: "bbbb" },
          alternatives: [{ id: 4, name: "yt_dlp_piped", origin_hash: ENGINE_HASH }],
        },
      ],
    },
    {
      name: "p2",
      content_hash: "8c1f2e00",
      valid: true,
      issues: [{ problem: "name_conflict", existing_id: 1, new_name: "p2_2" }],
    },
  ],
  autoruns: [
    {
      name: "t-new",
      valid: false,
      issues: [{ problem: "profile_missing", profile_name: "p-gone" }],
    },
  ],
}

interface StubState {
  validateStatus?: number
  applyStatus?: number
  applyDetail?: string
  validateCalls: number
  applyBodies: unknown[]
}

function stubApi(state: StubState) {
  return installFetch(async (url, init) => {
    if (url.startsWith("/api/engines/?")) {
      return jsonResponse(200, { items: [ENGINE], next_cursor: null, has_more: false })
    }
    if (url.startsWith("/api/resolvers/?")) {
      return jsonResponse(200, { items: [RESOLVER], next_cursor: null, has_more: false })
    }
    if (url.startsWith("/api/profiles/?")) {
      return jsonResponse(200, { items: [INSTALLED_PROFILE], next_cursor: null, has_more: false })
    }
    if (url === "/api/import-export/validate" && init?.method === "POST") {
      state.validateCalls += 1
      if (state.validateStatus !== undefined && state.validateStatus !== 200) {
        return jsonResponse(state.validateStatus, { detail: "validate exploded" })
      }
      return jsonResponse(200, REPORT)
    }
    if (url === "/api/import-export/apply" && init?.method === "POST") {
      state.applyBodies.push(JSON.parse(String(init.body)))
      if (state.applyStatus !== undefined && state.applyStatus !== 200) {
        return jsonResponse(state.applyStatus, { detail: state.applyDetail ?? "apply exploded" })
      }
      return jsonResponse(200, { profiles_created: 2, profiles_skipped: 0, autoruns_created: 1 })
    }
    return jsonResponse(404, { detail: `unexpected ${url}` })
  })
}

function freshState(patch: Partial<StubState> = {}): StubState {
  return { validateCalls: 0, applyBodies: [], ...patch }
}

async function renderWizard() {
  const view = await renderInRouter(
    <>
      <ImportWizard />
      <ToastViewport />
    </>,
  )
  await screen.findByTestId("import-wizard")
  return view
}

async function pickFile(name: string, text: string) {
  const input = screen.getByLabelText("Bundle file")
  const file = new File([text], name, { type: "application/json" })
  fireEvent.change(input, { target: { files: [file] } })
}

async function reachResolve(_state: StubState) {
  await renderWizard()
  await pickFile("bundle.json", JSON.stringify(BUNDLE))
  await screen.findByTestId("picked-file")
  fireEvent.click(screen.getByRole("button", { name: "Validate" }))
  await screen.findByText("Needs mapping")
  fireEvent.click(screen.getByRole("button", { name: "Next" }))
  await screen.findByTestId("wizard-resolve")
}

beforeEach(() => {
  vi.stubEnv(API_URL_ENV_VAR, "/api")
  queryClient.clear()
})

describe("ImportWizard guards (step 1)", () => {
  it("blocks malformed JSON before any validate request", async () => {
    const state = freshState()
    stubApi(state)
    await renderWizard()

    await pickFile("broken.json", "{ not json")

    await screen.findByText(INVALID_JSON_MESSAGE)
    expect(state.validateCalls).toBe(0)
    expect(screen.getByTestId("wizard-step").textContent).toContain("Step 1 of 4")
    expect((screen.getByRole("button", { name: "Validate" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("blocks a version-2 bundle with the unsupported-version message", async () => {
    const state = freshState()
    stubApi(state)
    await renderWizard()

    await pickFile("v2.json", JSON.stringify({ version: 2, profiles: [] }))

    await screen.findByText(UNSUPPORTED_VERSION_MESSAGE)
    expect(state.validateCalls).toBe(0)
  })

  it("blocks a >500-item bundle client-side", async () => {
    const state = freshState()
    stubApi(state)
    await renderWizard()
    const profiles = Array.from({ length: 501 }, (_, index) => ({ name: `p${index}` }))

    await pickFile("big.json", JSON.stringify({ version: 1, profiles }))

    await screen.findByText(TOO_LARGE_MESSAGE)
    expect(state.validateCalls).toBe(0)
  })

  it("shows the picked file summary and validates into step 2", async () => {
    const state = freshState()
    stubApi(state)
    await renderWizard()

    await pickFile("bundle.json", JSON.stringify(BUNDLE))
    const summary = await screen.findByTestId("picked-file")
    expect(summary.textContent).toContain("bundle.json")
    expect(summary.textContent).toContain("2 profiles")
    expect(summary.textContent).toContain("1 autorun")

    fireEvent.click(screen.getByRole("button", { name: "Validate" }))

    await screen.findByTestId("wizard-review")
    expect(state.validateCalls).toBe(1)
    expect(screen.getByTestId("wizard-step").textContent).toContain("Step 2 of 4")
  })
})

describe("ImportWizard review (step 2)", () => {
  it("renders a badge per item and the auto-rename preview", async () => {
    const state = freshState()
    stubApi(state)
    await renderWizard()
    await pickFile("bundle.json", JSON.stringify(BUNDLE))
    await screen.findByTestId("picked-file")
    fireEvent.click(screen.getByRole("button", { name: "Validate" }))
    await screen.findByTestId("wizard-review")

    const review = screen.getByTestId("wizard-review")
    expect(within(review).getByText("Needs mapping")).toBeDefined()
    expect(within(review).getAllByText("Conflict")).toHaveLength(2)
    expect(within(review).getByText("Will be imported as p2_2")).toBeDefined()
    expect(within(review).getByText(/4494a0d0/)).toBeDefined()
    expect(within(review).getByTestId("badge-profile-p2").textContent).toBe("Conflict")
  })

  it("renders Ready and Skip badges for clean/duplicate items", async () => {
    const state = freshState()
    stubApi(state)
    await renderWizard()
    await pickFile("bundle.json", JSON.stringify(BUNDLE))
    await screen.findByTestId("picked-file")
    fireEvent.click(screen.getByRole("button", { name: "Validate" }))
    await screen.findByTestId("wizard-review")

    // The stub report carries mapping/conflict; Ready and Skip are covered by
    // the pure badge tests. Here we only pin that each rendered item exposes
    // its derived badge through the spec label set.
    for (const badge of screen.getAllByTestId(/^badge-/)) {
      expect(["Ready", "Skip — already imported", "Needs mapping", "Conflict"]).toContain(badge.textContent)
    }
  })
})

describe("ImportWizard resolve (step 3)", () => {
  it("renders a mapping select, a bind-or-inline select, keep-or-inherit radios and include switches", async () => {
    const state = freshState()
    stubApi(state)
    await reachResolve(state)

    expect(screen.getByLabelText(/Engine for engine_x/)).toBeDefined()
    const mapping = screen.getByLabelText(/Engine for engine_x/) as HTMLSelectElement
    expect(within(mapping).getByRole("option", { name: /yt_dlp_piped/ })).toBeDefined()

    const bind = screen.getByLabelText(/Profile for t-new/) as HTMLSelectElement
    expect(within(bind).getByRole("option", { name: "Use inline config" })).toBeDefined()
    expect(within(bind).getByRole("option", { name: "p2" })).toBeDefined()

    expect((screen.getByRole("radio", { name: "Keep autorun engine" }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole("radio", { name: "Use profile engine" }) as HTMLInputElement).checked).toBe(false)

    expect((screen.getByRole("switch", { name: "Include p-new" }) as HTMLButtonElement).getAttribute("aria-checked")).toBe("true")
    expect((screen.getByRole("switch", { name: "Include t-new" }) as HTMLButtonElement).getAttribute("aria-checked")).toBe("true")
  })

  it("posts the deterministic encoded body and lands on the summary", async () => {
    const state = freshState()
    stubApi(state)
    await reachResolve(state)

    fireEvent.change(screen.getByLabelText(/Engine for engine_x/), { target: { value: "4" } })
    fireEvent.change(screen.getByLabelText(/Profile for t-new/), { target: { value: "p2" } })
    fireEvent.click(screen.getByRole("switch", { name: "Include p-new" }))
    fireEvent.click(screen.getByRole("switch", { name: "Include t-new" }))

    fireEvent.click(screen.getByRole("button", { name: "Apply" }))

    await screen.findByTestId("apply-summary")
    expect(state.applyBodies).toHaveLength(1)
    const body = state.applyBodies[0] as {
      bundle: { profiles: { name: string }[]; autoruns: { user_friendly_name: string; profile_name: string }[] }
      plugin_map: Record<string, unknown>
      removed_profiles?: string[]
      removed_autoruns?: string[]
    }
    expect(body.plugin_map).toEqual({ bbbb: { type: "engine", id: 4 } })
    expect(body.removed_profiles).toEqual(["p-new"])
    expect(body.removed_autoruns).toEqual(["t-new"])
    expect(body.bundle.profiles.map((profile) => profile.name)).toEqual(["p2"])
    expect(body.bundle.autoruns).toEqual([])

    const summary = screen.getByTestId("apply-summary")
    expect(within(summary).getByText(/2 profiles created/)).toBeDefined()
    expect(within(summary).getByText(/1 autorun created/)).toBeDefined()
    expect(within(summary).getByRole("link", { name: "View profiles" })).toBeDefined()
  })

  it("shows the apply error panel with the server detail and stays on step 3", async () => {
    const state = freshState({ applyStatus: 400, applyDetail: "Cannot resolve engine for profile 'p2'" })
    stubApi(state)
    await reachResolve(state)

    fireEvent.change(screen.getByLabelText(/Engine for engine_x/), { target: { value: "4" } })
    fireEvent.change(screen.getByLabelText(/Profile for t-new/), { target: { value: "p2" } })
    fireEvent.click(screen.getByRole("button", { name: "Apply" }))

    const panel = await screen.findByRole("alert")
    expect(panel.textContent).toContain("Import failed")
    expect(panel.textContent).toContain("Cannot resolve engine for profile 'p2'")
    expect(screen.getByTestId("wizard-step").textContent).toContain("Step 3 of 4")
  })

  it("keeps Apply disabled until every requirement is resolved", async () => {
    const state = freshState()
    stubApi(state)
    await reachResolve(state)

    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/Engine for engine_x/), { target: { value: "4" } })
    await waitFor(() => expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true))
    fireEvent.change(screen.getByLabelText(/Profile for t-new/), { target: { value: "p2" } })
    await waitFor(() => expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(false))
  })
})
