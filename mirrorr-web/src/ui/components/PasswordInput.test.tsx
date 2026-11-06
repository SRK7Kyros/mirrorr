import { describe, expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { PasswordInput } from "./PasswordInput"

describe("PasswordInput", () => {
  it("starts concealed and reveals on the toggle", () => {
    render(<PasswordInput aria-label="Password" defaultValue="s3cret" />)
    const input = screen.getByLabelText("Password", { selector: "input" })
    expect(input.getAttribute("type")).toBe("password")

    const toggle = screen.getByRole("button", { name: "Show password" })
    expect(toggle.getAttribute("aria-pressed")).toBe("false")

    fireEvent.click(toggle)

    expect(input.getAttribute("type")).toBe("text")
    expect(screen.getByRole("button", { name: "Hide password" }).getAttribute("aria-pressed")).toBe("true")
  })

  it("keeps the value while toggling, and points the toggle at its field", () => {
    render(<PasswordInput id="pw" aria-label="Password" defaultValue="s3cret" />)
    const input = screen.getByLabelText("Password", { selector: "input" })
    fireEvent.click(screen.getByRole("button", { name: "Show password" }))
    expect((input as HTMLInputElement).value).toBe("s3cret")
    expect(screen.getByRole("button", { name: "Hide password" }).getAttribute("aria-controls")).toBe("pw")
  })
})
