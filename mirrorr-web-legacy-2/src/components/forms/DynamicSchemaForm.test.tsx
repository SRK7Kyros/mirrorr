/**
 * DynamicSchemaForm contract (spec L403, client contract §8.1):
 * string → text, number/integer → number input honoring min/max, boolean →
 * switch, enum → select, integer array → comma tag input, nested object →
 * collapsible group, unknown keys → key/value editor rows; defaults and
 * required markers; the submitted object is `{...defaults, ...values}`.
 *
 * Owned by todo 15 and shared by D1, V8's editor and any future form.
 */
import { fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { DynamicSchemaForm } from "@/components/forms/DynamicSchemaForm"
import { mergeConfig, prefillValues } from "@/lib/schema-form"
import { readJsonSchema, type JsonSchema } from "@/lib/schemas/json-schema"

const SCHEMA = readJsonSchema({
  type: "object",
  title: "Stream config",
  properties: {
    url: { type: "string", title: "URL", default: "https://example.com/live.m3u8" },
    count: { type: "integer", title: "Count", default: 3, minimum: 1, maximum: 10 },
    ratio: { type: "number", minimum: 0.5 },
    record: { type: "boolean", title: "Record", default: true },
    mode: { type: "string", title: "Mode", enum: ["none", "count"], default: "none" },
    retryable_exit_codes: {
      type: "array",
      title: "Retryable exit codes",
      items: { type: "integer" },
    },
    headers: {
      type: "object",
      title: "Headers",
      properties: { referer: { type: "string", title: "Referer", default: "x" } },
    },
  },
  required: ["url", "count"],
})

interface HarnessProps {
  readonly schema: JsonSchema
  readonly initialValues: Record<string, unknown>
  readonly errors?: Readonly<Record<string, string>>
}

function Harness({ schema, initialValues, errors }: HarnessProps) {
  const [values, setValues] = useState(initialValues)
  const [submitted, setSubmitted] = useState<Record<string, unknown> | null>(null)

  return (
    <div>
      <DynamicSchemaForm
        schema={schema}
        values={values}
        onChange={setValues}
        errors={errors}
        path="resolver_config"
        idPrefix="config"
      />
      <button type="button" onClick={() => setSubmitted(mergeConfig(initialValues, values))}>
        Submit
      </button>
      {submitted !== null ? <output data-testid="submitted">{JSON.stringify(submitted)}</output> : null}
    </div>
  )
}

function renderForm(errors?: Readonly<Record<string, string>>) {
  render(<Harness schema={SCHEMA} initialValues={prefillValues(SCHEMA)} errors={errors} />)
}

describe("control mapping", () => {
  it("renders string, number and integer into typed inputs with min/max", () => {
    renderForm()

    const url = screen.getByLabelText("URL *")
    expect((url as HTMLInputElement).type).toBe("text")
    expect((url as HTMLInputElement).value).toBe("https://example.com/live.m3u8")

    const count = screen.getByLabelText("Count *") as HTMLInputElement
    expect(count.getAttribute("type")).toBe("number")
    expect(count.getAttribute("min")).toBe("1")
    expect(count.getAttribute("max")).toBe("10")
    expect(count.getAttribute("step")).toBe("1")
    expect(count.value).toBe("3")

    const ratio = screen.getByLabelText("Ratio") as HTMLInputElement
    expect(ratio.getAttribute("step")).toBe("any")
    expect(ratio.value).toBe("")
  })

  it("renders booleans as a switch and enums as a select with the default chosen", () => {
    renderForm()

    const record = screen.getByRole("switch", { name: "Record" })
    expect(record.getAttribute("aria-checked")).toBe("true")

    const mode = screen.getByLabelText("Mode") as HTMLSelectElement
    expect(mode.tagName).toBe("SELECT")
    expect(mode.value).toBe("none")
    expect(Array.from(mode.options).map((option) => option.value)).toEqual(["", "none", "count"])
  })

  it("renders an integer array as a comma tag input and a nested object as a collapsible group", () => {
    renderForm()

    const codes = screen.getByLabelText("Retryable exit codes") as HTMLInputElement
    expect(codes.getAttribute("placeholder")).toBe("1, 2, 3")

    const headers = screen.getByText("Headers")
    expect(headers.tagName).toBe("SUMMARY")
    expect((screen.getByLabelText("Referer") as HTMLInputElement).value).toBe("x")
  })

  it("does not mark optional fields as required", () => {
    renderForm()
    expect(screen.getByLabelText("Ratio")).toBeTruthy()
    expect(() => screen.getByLabelText("Ratio *")).toThrow()
  })

  it("shows a server error against its dotted field path", () => {
    renderForm({ "resolver_config.url": "Field required" })
    expect(screen.getByText("Field required")).toBeTruthy()
  })
})

describe("submission", () => {
  it("submits the edited values merged over the defaults", () => {
    renderForm()

    fireEvent.change(screen.getByLabelText("URL *"), { target: { value: "https://example.com/other.m3u8" } })
    fireEvent.change(screen.getByLabelText("Count *"), { target: { value: "7" } })
    fireEvent.click(screen.getByRole("switch", { name: "Record" }))
    fireEvent.change(screen.getByLabelText("Mode"), { target: { value: "count" } })
    fireEvent.change(screen.getByLabelText("Retryable exit codes"), { target: { value: "1, 2, 3" } })
    fireEvent.change(screen.getByLabelText("Referer"), { target: { value: "y" } })
    fireEvent.click(screen.getByRole("button", { name: "Submit" }))

    expect(JSON.parse(screen.getByTestId("submitted").textContent ?? "{}")).toEqual({
      url: "https://example.com/other.m3u8",
      count: 7,
      record: false,
      mode: "count",
      retryable_exit_codes: [1, 2, 3],
      headers: { referer: "y" },
    })
  })

  it("clears a numeric field to undefined instead of NaN", () => {
    renderForm()
    fireEvent.change(screen.getByLabelText("Count *"), { target: { value: "" } })
    fireEvent.click(screen.getByRole("button", { name: "Submit" }))

    const submitted = JSON.parse(screen.getByTestId("submitted").textContent ?? "{}")
    expect(submitted.count).toBeUndefined()
  })
})

describe("unknown keys", () => {
  const CLOSED_PROPS = readJsonSchema({
    type: "object",
    properties: { url: { type: "string", title: "URL", default: "u" } },
  })

  it("renders rows for values the schema does not declare and keeps them on edit", () => {
    const onChange = vi.fn()
    render(
      <DynamicSchemaForm
        schema={CLOSED_PROPS}
        values={{ url: "u", custom: "abc" }}
        onChange={onChange}
        idPrefix="config"
      />,
    )

    const keyInput = screen.getByLabelText("Key") as HTMLInputElement
    expect(keyInput.value).toBe("custom")
    expect((screen.getByLabelText("Value") as HTMLInputElement).value).toBe("abc")

    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "def" } })
    expect(onChange).toHaveBeenCalledWith({ url: "u", custom: "def" })
  })

  it("does not duplicate declared properties as key/value rows", () => {
    render(
      <DynamicSchemaForm
        schema={CLOSED_PROPS}
        values={{ url: "u", custom: "abc" }}
        onChange={vi.fn()}
        idPrefix="config"
      />,
    )

    const keyInput = screen.getByLabelText("Key") as HTMLInputElement
    expect(keyInput.value).not.toBe("url")
  })

  it("adds and removes free-form rows", () => {
    const onChange = vi.fn()
    render(
      <DynamicSchemaForm
        schema={CLOSED_PROPS}
        values={{ url: "u", extra: "1" }}
        onChange={onChange}
        idPrefix="config"
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Add" }))
    expect(onChange).toHaveBeenCalledWith({ url: "u", extra: "1", key2: "" })

    fireEvent.click(screen.getByRole("button", { name: "Remove extra" }))
    expect(onChange).toHaveBeenCalledWith({ url: "u" })
  })

  it("ignores undeclared values when the schema closes additionalProperties", () => {
    const closed = readJsonSchema({
      type: "object",
      properties: { url: { type: "string", title: "URL" } },
      additionalProperties: false,
    })
    render(
      <DynamicSchemaForm schema={closed} values={{ url: "u", custom: "abc" }} onChange={vi.fn()} idPrefix="config" />,
    )

    expect(screen.queryByLabelText("Key")).toBeNull()
  })

  it("renders a free-form editor for a property-less open object", () => {
    const open = readJsonSchema({ type: "object", additionalProperties: { type: "string" } })
    render(
      <DynamicSchemaForm schema={open} values={{ a: "1" }} onChange={vi.fn()} idPrefix="config" />,
    )

    expect((screen.getByLabelText("Key") as HTMLInputElement).value).toBe("a")
  })
})
