import { describe, expect, it } from "vitest"
import { normalizeValidateReport } from "./index"

describe("normalizeValidateReport", () => {
  it("maps the server's `problem` field onto `type`", () => {
    const report = normalizeValidateReport({
      items: [
        {
          name: "harbour-cam",
          kind: "profile",
          issues: [
            {
              problem: "not_installed",
              field: "engine",
              bundled: { origin_hash: "6e57a1c4" },
            },
          ],
        },
      ],
    })

    expect(report.items).toHaveLength(1)
    expect(report.items[0]?.issues[0]?.type).toBe("not_installed")
  })
})