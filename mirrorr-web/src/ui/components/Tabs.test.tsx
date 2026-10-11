import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { Segmented, TabPanel } from "./Tabs"

describe("tabs ↔ tabpanel wiring", () => {
  it("links each tab to its panel and names the panel after the active tab", () => {
    render(
      <>
        <Segmented
          ariaLabel="Start from"
          panelId="mode"
          active="profile"
          onChange={() => undefined}
          items={[
            { id: "profile", label: "A profile" },
            { id: "custom", label: "Engine + resolver" },
          ]}
        />
        <TabPanel panelId="mode" active="profile">
          <p>panel body</p>
        </TabPanel>
      </>,
    )

    const panel = screen.getByRole("tabpanel")
    expect(panel.getAttribute("id")).toBe("mode")
    expect(panel.getAttribute("aria-labelledby")).toBe("mode-tab-profile")

    const tabs = screen.getAllByRole("tab")
    expect(tabs.map((tab) => tab.getAttribute("aria-controls"))).toEqual(["mode", "mode"])
    expect(tabs.map((tab) => tab.getAttribute("id"))).toEqual([
      "mode-tab-profile",
      "mode-tab-custom",
    ])
  })

  it("omits the wiring when no panelId is given", () => {
    render(
      <Segmented
        ariaLabel="Start over"
        active="a"
        onChange={() => undefined}
        items={[
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ]}
      />,
    )

    for (const tab of screen.getAllByRole("tab")) {
      expect(tab.getAttribute("aria-controls")).toBeNull()
      expect(tab.getAttribute("id")).toBeNull()
    }
  })
})
