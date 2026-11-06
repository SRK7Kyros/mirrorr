import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import type { Engine, Profile, Resolver } from "@/api/schemas"
import { ProfileSummary, retrySummary } from "./new-session-profile-summary"

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 1,
    name: "F1 Weekend",
    default_engine_id: 1,
    resolver_id: 1,
    ...overrides,
  } as Profile
}

const ENGINES = [
  { id: 1, name: "Streamlink", origin: "builtin", origin_hash: "abc" },
] as readonly Engine[]
const RESOLVERS = [
  { id: 1, name: "Wide IPTV", origin: "builtin", origin_hash: "def" },
] as readonly Resolver[]

describe("retrySummary", () => {
  it("says a profile with no policy will not retry", () => {
    expect(retrySummary(profile())).toBe("No retry")
    expect(retrySummary(profile({ retry_mode: "none" }))).toBe("No retry")
  })

  it("names the mode and the settings that decide when it fires", () => {
    expect(
      retrySummary(profile({ retry_mode: "fixed_delay", retry_config: { attempts: 3, delay: 5 } })),
    ).toBe("Fixed delay — attempts=3 · delay=5")
  })
})

describe("ProfileSummary", () => {
  it("reads the catalog when the profile carries no joined names", () => {
    render(<ProfileSummary profile={profile()} engines={ENGINES} resolvers={RESOLVERS} recording={false} />)
    expect(screen.getByText(/Wide IPTV/)).toBeTruthy()
    expect(screen.getByText(/Streamlink/)).toBeTruthy()
  })

  it("prefers the profile's own names and never renders an empty cell", () => {
    render(
      <ProfileSummary
        profile={profile({ engine_name: "yt-dlp", resolver_name: "Sky" })}
        engines={[]}
        resolvers={[]}
        recording
      />,
    )
    expect(screen.getByText(/Sky/)).toBeTruthy()
    expect(screen.getByText(/yt-dlp/)).toBeTruthy()
  })

  it("names an id the catalog cannot resolve instead of leaving a blank", () => {
    render(
      <ProfileSummary
        profile={profile({ default_engine_id: 4, resolver_id: 3 })}
        engines={[]}
        resolvers={[]}
        recording={false}
      />,
    )
    expect(screen.getByText(/Source #3/)).toBeTruthy()
    expect(screen.getByText(/Engine #4/)).toBeTruthy()
  })

  it("states what the switch will do, both ways", () => {
    const { rerender } = render(
      <ProfileSummary profile={profile()} engines={ENGINES} resolvers={RESOLVERS} recording={false} />,
    )
    expect(screen.getByText("Off — nothing is saved")).toBeTruthy()
    rerender(<ProfileSummary profile={profile()} engines={ENGINES} resolvers={RESOLVERS} recording />)
    expect(screen.getByText("On — a file is written to disk")).toBeTruthy()
  })
})
