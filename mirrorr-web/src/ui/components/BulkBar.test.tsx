import { afterEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { BulkBar, PHONE_INLINE_ACTIONS, type BulkAction } from "./BulkBar"

function setPhone(phone: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: phone,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
}

function actions(): BulkAction[] {
  const onClick = vi.fn()
  return [
    { key: "access", label: "Access", icon: <span />, onClick },
    { key: "export", label: "Export selected", icon: <span />, onClick },
    { key: "profile", label: "Set profile", icon: <span />, onClick },
    { key: "delete", label: "Delete selected", icon: <span />, danger: true, onClick },
  ]
}

afterEach(() => {
  document.body.innerHTML = ""
})

describe("BulkBar", () => {
  it("keeps the labelled row on a wide screen", () => {
    setPhone(false)
    render(<BulkBar count={3} onClear={() => undefined} actions={actions()} />)

    expect(screen.getByText("3 selected items").textContent).toBe("3 selected items")
    for (const action of actions()) {
      expect(screen.getByRole("button", { name: action.label })).toBeTruthy()
    }
    expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy()
  })

  it("draws every action as an icon on a phone when they all fit", () => {
    setPhone(true)
    const list = actions().slice(0, PHONE_INLINE_ACTIONS)
    render(<BulkBar count={2} onClear={() => undefined} actions={list} nextToFab />)

    expect(screen.getByText("2")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "More bulk actions" })).toBeNull()
    for (const action of list) {
      expect(screen.getByRole("button", { name: action.label })).toBeTruthy()
    }
  })

  it("moves what does not fit into the overflow menu", () => {
    setPhone(true)
    const list = actions()
    render(<BulkBar count={1} onClear={() => undefined} actions={list} nextToFab />)

    expect(screen.queryByRole("button", { name: "Delete selected" })).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "More bulk actions" }))

    const menu = screen.getByRole("menu")
    const rows = within(menu).getAllByRole("menuitem")
    expect(rows).toHaveLength(list.length - (PHONE_INLINE_ACTIONS - 1))
    expect(within(menu).getByRole("menuitem", { name: "Delete selected" })).toBeTruthy()
  })

  it("clears the selection from the pill", () => {
    const onClear = vi.fn()
    setPhone(true)
    render(<BulkBar count={1} onClear={onClear} actions={actions()} />)

    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })
})
