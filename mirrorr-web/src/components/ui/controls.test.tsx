import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Play } from "lucide-react"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Select } from "@/components/ui/Select"

/**
 * Button / Input / Select contracts: spec L107-L108 (variants, `--bg-base`
 * text on accent/danger, disabled 40% + no pointer, 32px controls, focus =
 * border-strong + 2px accent ring offset 1, error = danger border + 12px
 * danger message). Geometry is class-encoded here and measured in the browser
 * by tests/e2e/tokens.spec.ts.
 */

describe("Button", () => {
  it("renders primary with accent fill and --bg-base text at 32px", () => {
    render(<Button variant="primary">Save</Button>)

    const button = screen.getByRole("button", { name: "Save" })
    expect(button.className).toContain("bg-accent")
    expect(button.className).toContain("text-bg-base")
    expect(button.className).toContain("h-8")
    expect(button.className).toContain("disabled:opacity-40")
    expect(button.className).toContain("disabled:pointer-events-none")
    expect(button.className).toContain("focus-visible:outline-2")
    expect(button.className).toContain("focus-visible:outline-offset-1")
    expect(button.className).toContain("focus-visible:outline-accent")
  })

  it("renders danger with danger fill and --bg-base text", () => {
    render(<Button variant="danger">Delete</Button>)

    const button = screen.getByRole("button", { name: "Delete" })
    expect(button.className).toContain("bg-danger")
    expect(button.className).toContain("text-bg-base")
  })

  it("renders secondary and ghost surfaces", () => {
    const { rerender } = render(<Button variant="secondary">Cancel</Button>)
    expect(screen.getByRole("button", { name: "Cancel" }).className).toContain("bg-bg-overlay")

    rerender(<Button variant="ghost">Skip</Button>)
    const ghost = screen.getByRole("button", { name: "Skip" })
    expect(ghost.className).toContain("text-text-secondary")
    expect(ghost.className).not.toContain("bg-")
  })

  it("renders icon-only controls as 32px targets with a labelled 16px icon", () => {
    render(<Button icon={Play} aria-label="Start recording" title="Start recording" />)

    const button = screen.getByRole("button", { name: "Start recording" })
    expect(button.className).toContain("w-8")
    expect(button.hasAttribute("disabled")).toBe(false)
    expect(button.getAttribute("title")).toBe("Start recording")

    const icon = button.querySelector("svg")
    expect(icon?.getAttribute("class")).toContain("size-[var(--icon-default)]")
    expect(icon?.getAttribute("stroke-width")).toBe("2")
    expect(icon?.getAttribute("aria-hidden")).toBe("true")
  })
})

describe("Input / Select", () => {
  it("pairs the label and renders the 32px control with the spec focus ring", () => {
    render(<Input label="Search" placeholder="Search sessions" />)

    const input = screen.getByLabelText("Search")
    expect(input.className).toContain("h-8")
    expect(input.className).toContain("bg-bg-base")
    expect(input.className).toContain("rounded-control")
    expect(input.className).toContain("text-body")
    expect(input.className).toContain("focus:border-border-strong")
    expect(input.className).toContain("focus-visible:outline-2")
    expect(input.className).toContain("focus-visible:outline-offset-1")
    expect(input.className).toContain("focus-visible:outline-accent")
  })

  it("paints the danger border and a 12px described message on error", () => {
    render(<Input label="Name" error="Required" />)

    const input = screen.getByLabelText("Name")
    const message = screen.getByText("Required")

    expect(input.className).toContain("border-danger")
    expect(input.getAttribute("aria-invalid")).toBe("true")
    expect(message.className).toContain("text-small")
    expect(message.className).toContain("text-danger")
    expect(input.getAttribute("aria-describedby")).toBe(message.id)
  })

  it("renders Select with the same geometry and labelled options", () => {
    render(
      <Select label="Status" defaultValue="active">
        <option value="active">Active</option>
        <option value="recording">Recording</option>
      </Select>,
    )

    const select = screen.getByLabelText("Status")
    expect(select.className).toContain("h-8")
    expect(select.className).toContain("focus-visible:outline-accent")
    expect(screen.getByRole("option", { name: "Recording" })).toBeTruthy()
  })
})
