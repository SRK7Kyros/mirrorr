import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { EntityCard } from "./EntityCard"

function renderCard(overrides: Partial<Parameters<typeof EntityCard>[0]> = {}) {
  return render(
    <EntityCard
      header={<button type="button">menu</button>}
      media={<div data-testid="media">frame</div>}
      hero={<span>hero</span>}
      detail={<span>detail</span>}
      identity={<span>identity</span>}
      footer={<span>footer</span>}
      {...overrides}
    />,
  )
}

describe("EntityCard slot contract", () => {
  it("renders the six slots in the invariant order", () => {
    const { container } = renderCard()
    const order = Array.from(container.querySelectorAll("[data-slot]")).map((node) =>
      node.getAttribute("data-slot"),
    )
    expect(order).toEqual(["entity-card", "header", "media", "hero", "detail", "identity", "footer"])
  })

  it("collapses a slot it was not given, and keeps the media box when it was", () => {
    const { container } = renderCard({ detail: undefined, footer: undefined })
    expect(container.querySelector('[data-slot="detail"]')).toBeNull()
    expect(container.querySelector('[data-slot="footer"]')).toBeNull()
    expect(container.querySelector('[data-slot="media"]')).not.toBeNull()
  })

  it("allows a surface with no media at all (Autoruns)", () => {
    const { container } = renderCard({ media: undefined })
    expect(container.querySelector('[data-slot="media"]')).toBeNull()
  })

  it("opens the card on a body click but never from an interactive descendant", () => {
    const onOpen = vi.fn()
    renderCard({ onOpen })
    fireEvent.click(screen.getByText("identity"))
    expect(onOpen).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole("button", { name: "menu" }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it("publishes the issue code and selection state as data attributes", () => {
    const { container } = renderCard({ issue: "profile-deleted", selected: true })
    const card = container.querySelector('[data-slot="entity-card"]')
    expect(card?.getAttribute("data-issue")).toBe("profile-deleted")
    expect(card?.getAttribute("data-selected")).toBe("true")
  })
})
