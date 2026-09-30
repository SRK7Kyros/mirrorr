import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { PlaceholderView } from "@/components/PlaceholderView"

describe("scaffold shell", () => {
  it("renders the neutral placeholder", () => {
    render(<PlaceholderView />)
    expect(screen.getByRole("heading", { name: "Mirrorr" })).toBeTruthy()
  })
})
