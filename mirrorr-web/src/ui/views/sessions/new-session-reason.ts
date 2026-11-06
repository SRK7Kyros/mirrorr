import { chainProblemSentence, type ChainProblem } from "@/api/domain/fallback-chain"

/**
 * Why `Start session` is disabled, in the operator's words (`CMP-20`, `FLW-01`).
 *
 * The dialog used to disable its primary with no explanation while the catalog
 * queries were still in flight or had failed, so "nothing to pick" and "the
 * request died" looked identical. The order below is deliberate: a failed list
 * outranks an empty one (it is not empty, it is unknown), and both outrank the
 * chain's own complaint — a chain cannot be read against a catalog that never
 * arrived.
 */
export interface SubmitGateInput {
  readonly mode: "profile" | "custom"
  readonly profileId: string
  readonly engineId: string
  readonly resolverId: string
  readonly profilesLoading: boolean
  readonly profilesError: boolean
  readonly enginesLoading: boolean
  readonly enginesError: boolean
  readonly resolversLoading: boolean
  readonly resolversError: boolean
  readonly chainProblem: ChainProblem | null
}

export function submitBlockedReason(input: SubmitGateInput): string | null {
  if (input.enginesError || input.resolversError) {
    return "The engine or source list could not be loaded — retry it above."
  }
  if (input.mode === "profile" && input.profilesError) {
    return "The profile list could not be loaded — retry it above."
  }

  const loading =
    input.mode === "profile"
      ? input.profilesLoading
      : input.enginesLoading || input.resolversLoading
  if (loading) return "Loading the catalogs this session starts from…"

  if (input.mode === "profile") {
    if (input.profileId === "") return "Choose a profile to start."
  } else {
    if (input.engineId === "") return "Choose an engine."
    if (input.resolverId === "") return "Choose a source."
  }

  // A profile-mode chain patches the profile's own capture, so the sentence must
  // name that subject ("the profile's own source"), not the run's.
  if (input.chainProblem !== null) {
    return chainProblemSentence(input.chainProblem, input.mode === "profile" ? "profile" : "run")
  }
  return null
}
