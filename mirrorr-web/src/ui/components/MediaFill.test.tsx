import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { MediaFill, firstFrameUrl } from "./MediaFill"

describe("MediaFill", () => {
  it("seeks a cover just past zero so a frame paints", () => {
    expect(firstFrameUrl("https://x/a.mp4")).toBe("https://x/a.mp4#t=0.1")
    expect(firstFrameUrl("https://x/a.mp4#frag")).toBe("https://x/a.mp4#frag")
  })

  it("renders a plate from the record's fields, headline first", () => {
    render(
      <MediaFill
        fill="plate"
        label="Capture failed"
        fields={["Stream ended early", "3 attempts", "12.0 MB captured"]}
      />,
    )
    expect(screen.getByText("Stream ended early")).toBeTruthy()
    expect(screen.getByText("3 attempts")).toBeTruthy()
    expect(screen.getByText("12.0 MB captured")).toBeTruthy()
    expect(screen.getByText("Capture failed")).toBeTruthy()
  })

  it("pins the remux line inside whichever fill is showing", () => {
    const { container } = render(
      <MediaFill fill="plate" label="Recording" fields={["1:53:10", "127 MB", "file kept"]} pin={<span>Remuxing 68%</span>} />,
    )
    const pin = container.querySelector('[data-slot="media-pin"]')
    expect(pin?.textContent).toContain("Remuxing 68%")
  })

  it("exposes the fill as a closed, inspectable attribute", () => {
    const { container } = render(<MediaFill fill="cover" src="https://x/a.mp4" label="Recording preview" />)
    expect(container.querySelector('[data-slot="media-fill"]')?.getAttribute("data-fill")).toBe("cover")
  })
})
