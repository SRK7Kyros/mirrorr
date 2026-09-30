/**
 * Spec L17-L23, L489-L491: the sidebar renders the seven destinations in spec
 * order, marks the active item with the overlay background plus a 2px accent
 * left bar, and collapses to a 56px icon-only rail below 900px (the rail's
 * actual width is asserted in Playwright, where a viewport exists).
 */
import { fireEvent, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SidebarNav } from "@/components/chrome/SidebarNav"
import { API_URL_ENV_VAR } from "@/config/env"
import { clearAuthSession } from "@/lib/auth-store"
import { queryClient } from "@/query-client"
import { renderInRouter } from "@/test/router-harness"

beforeEach(() => {
  vi.stubEnv(API_URL_ENV_VAR, "/api")
})

afterEach(() => {
  clearAuthSession()
  queryClient.clear()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("SidebarNav", () => {
  it("renders the seven destinations in spec order", async () => {
    await renderInRouter(<SidebarNav />, "/sessions")

    const nav = screen.getByRole("navigation", { name: "Primary" })
    const labels = within(nav)
      .getAllByRole("link")
      .map((link) => link.textContent?.replace(/\s+/g, " ").trim())

    expect(labels).toEqual([
      "Sessions",
      "Autoruns",
      "Recordings",
      "Profiles",
      "Plugins",
      "Import/Export",
      "Settings",
    ])
  })

  it("marks the active item with aria-current, the overlay background and the accent bar", async () => {
    await renderInRouter(<SidebarNav />, "/sessions/128")

    const nav = screen.getByRole("navigation", { name: "Primary" })
    const active = within(nav).getByRole("link", { name: "Sessions" })

    expect(active.getAttribute("aria-current")).toBe("page")
    expect(active.className).toContain("bg-bg-overlay")
    expect(within(active).getByTestId("nav-active-bar").className).toContain("bg-accent")

    const inactive = within(nav).getByRole("link", { name: "Autoruns" })
    expect(inactive.getAttribute("aria-current")).toBeNull()
    expect(within(inactive).getByTestId("nav-active-bar").className).toContain("bg-transparent")
  })

  it("keeps Settings active on its admin sub-routes", async () => {
    await renderInRouter(<SidebarNav />, "/settings/users")

    const nav = screen.getByRole("navigation", { name: "Primary" })
    expect(within(nav).getByRole("link", { name: "Settings" }).getAttribute("aria-current")).toBe("page")
  })

  it("navigates between destinations on click", async () => {
    const { router } = await renderInRouter(<SidebarNav />, "/sessions")

    fireEvent.click(screen.getByRole("link", { name: "Autoruns" }))

    expect(router.state.location.pathname).toBe("/autoruns")
  })

  it("carries the collapsed-rail width classes for the 640-899px state", async () => {
    await renderInRouter(<SidebarNav />, "/sessions")

    const sidebar = screen.getByTestId("sidebar")
    expect(sidebar.className).toContain("w-14")
    expect(sidebar.className).toContain("min-[900px]:w-56")
  })
})
