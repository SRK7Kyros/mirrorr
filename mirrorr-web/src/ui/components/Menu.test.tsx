import { describe, expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { DropdownMenu, MenuItem } from "./Menu"

function Harness() {
  return (
    <DropdownMenu label="Actions">
      <MenuItem>Edit</MenuItem>
      <MenuItem disabled>Disabled</MenuItem>
      <MenuItem danger>Delete</MenuItem>
    </DropdownMenu>
  )
}

describe("menu keyboard navigation", () => {
  it("focuses the first enabled item, roves with the arrows and restores focus on Escape", () => {
    render(<Harness />)

    const trigger = screen.getByRole("button", { name: "Actions" })
    fireEvent.click(trigger)

    const edit = screen.getByRole("menuitem", { name: "Edit" })
    const del = screen.getByRole("menuitem", { name: "Delete" })

    // Opening lands on the first enabled item; the disabled one is skipped.
    expect(document.activeElement).toBe(edit)

    fireEvent.keyDown(document, { key: "ArrowDown" })
    expect(document.activeElement).toBe(del)

    fireEvent.keyDown(document, { key: "ArrowDown" })
    expect(document.activeElement).toBe(edit)

    fireEvent.keyDown(document, { key: "ArrowUp" })
    expect(document.activeElement).toBe(del)

    fireEvent.keyDown(document, { key: "End" })
    expect(document.activeElement).toBe(del)

    fireEvent.keyDown(document, { key: "Home" })
    expect(document.activeElement).toBe(edit)

    fireEvent.keyDown(document, { key: "Escape" })
    expect(document.activeElement).toBe(trigger)
  })
})