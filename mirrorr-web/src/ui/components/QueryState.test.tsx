import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryState } from "./QueryState"

const loading = <p>skeleton</p>
const empty = <p>nothing here</p>

describe("QueryState", () => {
  it("shows the skeleton while the request is in flight", () => {
    render(
      <QueryState query={{ isLoading: true }} loading={loading} empty={empty} isEmpty errorMessage="x">
        <p>rows</p>
      </QueryState>,
    )
    expect(screen.getByText("skeleton")).toBeTruthy()
  })

  it("never renders a failed request as an empty list", () => {
    render(
      <QueryState
        query={{ isError: true, error: new Error("nope"), refetch: vi.fn() }}
        loading={loading}
        empty={empty}
        isEmpty
        errorMessage="Could not load"
      >
        <p>rows</p>
      </QueryState>,
    )
    expect(screen.queryByText("nothing here")).toBeNull()
    expect(screen.queryByText("rows")).toBeNull()
    expect(screen.getByText("nope")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy()
  })

  it("prefers the server message and falls back when the error is silent", () => {
    const { rerender } = render(
      <QueryState query={{ isError: true, error: new Error("") }} loading={loading} errorMessage="Fallback copy">
        <p>rows</p>
      </QueryState>,
    )
    expect(screen.getByText("Fallback copy")).toBeTruthy()

    rerender(
      <QueryState query={{ isError: true, error: undefined }} loading={loading} errorMessage="Fallback copy">
        <p>rows</p>
      </QueryState>,
    )
    expect(screen.getByText("Fallback copy")).toBeTruthy()
  })

  it("renders the empty state only when the view says it is empty", () => {
    render(
      <QueryState query={{}} loading={loading} empty={empty} isEmpty errorMessage="x">
        <p>rows</p>
      </QueryState>,
    )
    expect(screen.getByText("nothing here")).toBeTruthy()
  })

  it("retries through the query when no handler is given", () => {
    const refetch = vi.fn()
    render(
      <QueryState query={{ isError: true, error: new Error("nope"), refetch }} loading={loading} errorMessage="x">
        <p>rows</p>
      </QueryState>,
    )
    screen.getByRole("button", { name: "Retry" }).click()
    expect(refetch).toHaveBeenCalled()
  })
})
