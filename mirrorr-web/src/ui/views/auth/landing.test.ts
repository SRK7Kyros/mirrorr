import { describe, expect, it } from "vitest"
import { postAuthLanding } from "./landing"

// `__ADMIN__` is a build-time constant (`false` here), so this only ever
// exercises the standard build: the admin build's own branch is chosen at build
// time and is unreachable from a test.
describe("postAuthLanding", () => {
  it("sends an admin into the admin console, which is the other build", () => {
    expect(postAuthLanding("admin")).toEqual({ kind: "document", path: "/admin/settings" })
  })

  it("sends everyone else to the session list", () => {
    expect(postAuthLanding("user")).toEqual({ kind: "route", to: "/sessions" })
    expect(postAuthLanding(null)).toEqual({ kind: "route", to: "/sessions" })
    expect(postAuthLanding(undefined)).toEqual({ kind: "route", to: "/sessions" })
  })
})
