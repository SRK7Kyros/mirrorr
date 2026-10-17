import { describe, expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { useFocusScope } from "./focus-scope"

function Harness() {
  const scope = useFocusScope<HTMLFormElement>()
  return (
    <div>
      <button type="button">Before</button>
      <form ref={scope.ref} onKeyDown={scope.onKeyDown}>
        <input aria-label="First" />
        <input aria-label="Middle" />
        <button type="submit">Save</button>
      </form>
      <button type="button">After</button>
    </div>
  )
}

function field(name: string): HTMLInputElement {
  return screen.getByRole("textbox", { name }) as HTMLInputElement
}

describe("useFocusScope", () => {
  it("wraps Tab from the last control back to the first", () => {
    render(<Harness />)
    const save = screen.getByRole("button", { name: "Save" })
    save.focus()

    expect(fireEvent.keyDown(save, { key: "Tab" })).toBe(false)

    expect(document.activeElement).toBe(field("First"))
  })

  it("wraps Shift+Tab from the first control to the last", () => {
    render(<Harness />)
    const first = field("First")
    first.focus()

    expect(fireEvent.keyDown(first, { key: "Tab", shiftKey: true })).toBe(false)

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Save" }))
  })

  it("leaves a Tab in the middle of the form alone", () => {
    render(<Harness />)
    const middle = field("Middle")
    middle.focus()

    expect(fireEvent.keyDown(middle, { key: "Tab" })).toBe(true)

    expect(document.activeElement).toBe(middle)
  })

  it("hands focus to the next control outside the form on Escape", () => {
    render(<Harness />)
    const middle = field("Middle")
    middle.focus()

    fireEvent.keyDown(middle, { key: "Escape" })

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "After" }))
  })

  it("leaves focus alone on Escape when nothing outside the form is focusable", () => {
    function Bare() {
      const scope = useFocusScope<HTMLFormElement>()
      return (
        <form ref={scope.ref} onKeyDown={scope.onKeyDown}>
          <input aria-label="Only" />
        </form>
      )
    }
    render(<Bare />)
    const only = screen.getByRole("textbox", { name: "Only" })
    only.focus()

    fireEvent.keyDown(only, { key: "Escape" })

    expect(document.activeElement).toBe(only)
    expect(fireEvent.keyDown(only, { key: "a" })).toBe(true)
  })
})
