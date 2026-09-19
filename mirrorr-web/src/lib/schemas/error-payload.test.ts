import { describe, expect, it } from "vitest"
import {
  VALIDATION_FAILED_DETAIL,
  detailFromEnvelope,
  fieldErrorsFromEnvelope,
} from "@/lib/schemas/error-payload"

describe("fieldErrorsFromEnvelope", () => {
  it("maps pydantic detail arrays, dropping the transport prefix", () => {
    expect(
      fieldErrorsFromEnvelope({
        detail: [
          { type: "missing", loc: ["body", "engine_id"], msg: "Field required" },
          { type: "int_parsing", loc: ["body", "limit"], msg: "Input should be a valid integer" },
        ],
      }),
    ).toEqual({ engine_id: "Field required", limit: "Input should be a valid integer" })
  })

  it("maps the custom {detail, errors} shape", () => {
    expect(
      fieldErrorsFromEnvelope({
        detail: "Invalid data format provided for update.",
        errors: [{ loc: ["body", "url"], msg: "Invalid URL" }],
      }),
    ).toEqual({ url: "Invalid URL" })
  })

  it("joins nested field locations", () => {
    expect(
      fieldErrorsFromEnvelope({ detail: [{ loc: ["body", "capture", "output_dir"], msg: "bad" }] }),
    ).toEqual({ "capture.output_dir": "bad" })
  })

  it("returns undefined when there is nothing to map", () => {
    expect(fieldErrorsFromEnvelope({ detail: "Not your session" })).toBeUndefined()
    expect(fieldErrorsFromEnvelope("<html>")).toBeUndefined()
    expect(fieldErrorsFromEnvelope({ detail: [] })).toBeUndefined()
  })
})

describe("detailFromEnvelope", () => {
  it("keeps a string detail and summarizes an array detail", () => {
    expect(detailFromEnvelope({ detail: "Not your session" })).toBe("Not your session")
    expect(detailFromEnvelope({ detail: [{ loc: ["body", "x"], msg: "Field required" }] })).toBe(
      VALIDATION_FAILED_DETAIL,
    )
  })

  it("returns undefined for non-envelopes", () => {
    expect(detailFromEnvelope(undefined)).toBeUndefined()
    expect(detailFromEnvelope({ detail: "" })).toBeUndefined()
    expect(detailFromEnvelope({ detail: [] })).toBeUndefined()
  })
})
