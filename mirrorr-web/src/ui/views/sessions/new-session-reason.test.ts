import { describe, expect, it } from "vitest"
import { submitBlockedReason, type SubmitGateInput } from "./new-session-reason"

function input(overrides: Partial<SubmitGateInput> = {}): SubmitGateInput {
  return {
    mode: "profile",
    profileId: "",
    engineId: "",
    resolverId: "",
    profilesLoading: false,
    profilesError: false,
    enginesLoading: false,
    enginesError: false,
    resolversLoading: false,
    resolversError: false,
    chainProblem: null,
    ...overrides,
  }
}

describe("submitBlockedReason", () => {
  it("lets a chosen profile with a clean chain start", () => {
    expect(submitBlockedReason(input({ profileId: "3" }))).toBeNull()
    expect(
      submitBlockedReason(input({ mode: "custom", engineId: "1", resolverId: "2" })),
    ).toBeNull()
  })

  it("asks for the missing choice rather than sitting disabled in silence", () => {
    expect(submitBlockedReason(input())).toBe("Choose a profile to start.")
    expect(submitBlockedReason(input({ mode: "custom" }))).toBe("Choose an engine.")
    expect(submitBlockedReason(input({ mode: "custom", engineId: "1" }))).toBe("Choose a source.")
  })

  it("says it is still loading instead of pretending nothing exists", () => {
    expect(submitBlockedReason(input({ profilesLoading: true }))).toBe(
      "Loading the catalogs this session starts from…",
    )
    expect(
      submitBlockedReason(input({ mode: "custom", enginesLoading: true, engineId: "1", resolverId: "1" })),
    ).toBe("Loading the catalogs this session starts from…")
  })

  it("names the failed list and outranks the empty one", () => {
    expect(submitBlockedReason(input({ profilesError: true }))).toBe(
      "The profile list could not be loaded — retry it above.",
    )
    expect(submitBlockedReason(input({ enginesError: true, profileId: "1" }))).toBe(
      "The engine or source list could not be loaded — retry it above.",
    )
  })

  it("passes the chain's own complaint through with the subject that owns it", () => {
    expect(submitBlockedReason(input({ profileId: "1", chainProblem: { index: 0, kind: "primary" } }))).toBe(
      "Fallback 1 is the profile’s own source — change what it names.",
    )
    expect(
      submitBlockedReason(
        input({ mode: "custom", engineId: "1", resolverId: "1", chainProblem: { index: 1, kind: "duplicate", first: 0 } }),
      ),
    ).toBe("Fallback 2 repeats fallback 1 — remove one of them.")
  })
})
