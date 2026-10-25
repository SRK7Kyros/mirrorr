import { describe, expect, it } from "vitest"
import { autorunIssue, flaggedCount, flaggedNotice } from "./autorun-issue"

describe("autorunIssue", () => {
  it("says nothing about a healthy schedule", () => {
    expect(autorunIssue({ issue: null })).toBeNull()
    expect(autorunIssue({ issue: undefined })).toBeNull()
    expect(autorunIssue({ issue: "" })).toBeNull()
  })

  it("explains a deleted profile", () => {
    const issue = autorunIssue({ issue: "profile-deleted" })
    expect(issue?.label).toBe("Needs attention")
    expect(issue?.title).toContain("profile was deleted")
    expect(issue?.detail).toContain("save")
  })

  it("still flags a reason this console does not know", () => {
    const issue = autorunIssue({ issue: "resolver-uninstalled" })
    expect(issue?.label).toBe("Needs attention")
    expect(issue?.title).toContain("resolver-uninstalled")
    expect(issue?.detail).not.toBe("")
  })
})

describe("flaggedCount", () => {
  it("counts only the blocked rows", () => {
    expect(flaggedCount([{ issue: null }, { issue: "profile-deleted" }, { issue: "" }])).toBe(1)
    expect(flaggedCount([])).toBe(0)
  })
})

describe("flaggedNotice", () => {
  it("says nothing when no schedule was flagged", () => {
    expect(flaggedNotice(0)).toBe("")
  })

  it("reads as one sentence for one or for many", () => {
    expect(flaggedNotice(1)).toContain("1 scheduled recording needs")
    expect(flaggedNotice(4)).toContain("4 scheduled recordings need")
  })
})
