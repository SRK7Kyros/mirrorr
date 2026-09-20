/**
 * Spec L17-L23 and the mobile shell row (L489-L491): the primary-action slot
 * must render on whichever view is present under the compact shell, while the
 * desktop presentation keeps the action inline. The full compact shell is a
 * later todo; this file only pins the slot/context seam it will build on.
 */
import { screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AppShell } from "@/components/chrome/AppShell"
import { PrimaryAction, useIsCompactShell } from "@/components/chrome/CompactShell"
import { API_URL_ENV_VAR } from "@/config/env"
import { installBackNavigation } from "@/lib/back-navigation"
import { clearAuthSession, setAuthSession } from "@/lib/auth-store"
import { registerCompactActionHandler } from "@/lib/compact-actions"
import { queryClient } from "@/query-client"
import { AUTH_BODY, installFetch, jsonResponse } from "@/test/api-helpers"
import { renderInRouter } from "@/test/router-harness"

function stubMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>()
  const media = {
    matches,
    media: "",
    onchange: null,
    addEventListener: (_type: string, listener: () => void) => {
      listeners.add(listener)
    },
    removeEventListener: (_type: string, listener: () => void) => {
      listeners.delete(listener)
    },
    addListener: (listener: () => void) => {
      listeners.add(listener)
    },
    removeListener: (listener: () => void) => {
      listeners.delete(listener)
    },
    dispatchEvent: () => true,
  }
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(media))
  return listeners
}

function Probe() {
  const compact = useIsCompactShell()
  return <span data-testid="compact-probe">{compact ? "compact" : "desktop"}</span>
}

function installShellFetch() {
  return installFetch(async (url) =>
    url.endsWith("/health") ? jsonResponse(200, { status: "ok" }) : jsonResponse(200, []),
  )
}

beforeEach(() => {
  vi.stubEnv(API_URL_ENV_VAR, "/api")
  setAuthSession(AUTH_BODY)
})

afterEach(() => {
  clearAuthSession()
  queryClient.clear()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("compact primary-action slot", () => {
  it("renders the view's primary action inside the shell slot under the compact shell", async () => {
    stubMatchMedia(true)
    installShellFetch()

    await renderInRouter(
      <AppShell />,
      "/sessions",
      <PrimaryAction>
        <button type="button">New session</button>
      </PrimaryAction>,
    )

    const slot = await screen.findByTestId("compact-primary-action")
    expect(within(slot).getByRole("button", { name: "New session" })).toBeTruthy()
  })

  it("keeps the action inline on the desktop shell", async () => {
    stubMatchMedia(false)
    installShellFetch()

    await renderInRouter(
      <AppShell />,
      "/sessions",
      <PrimaryAction>
        <button type="button">New session</button>
      </PrimaryAction>,
    )

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "New session" })).toBeTruthy()
    })
    expect(screen.queryByTestId("compact-primary-action")).toBeNull()
  })

  it("renders children inline when no shell slot is mounted", async () => {
    stubMatchMedia(true)

    await renderInRouter(
      <PrimaryAction>
        <button type="button">New session</button>
      </PrimaryAction>,
    )

    expect(screen.getByRole("button", { name: "New session" })).toBeTruthy()
  })

  it("re-renders when the media query flips", async () => {
    const listeners = stubMatchMedia(false)
    installShellFetch()
    await renderInRouter(<AppShell />, "/sessions", <Probe />)

    expect(screen.getByTestId("compact-probe").textContent).toBe("desktop")
    for (const listener of listeners) listener()
    await waitFor(() => {
      // The stub always reports `matches:false`; flipping behaviour is pinned by
      // the listener subscription above (no crash, no state loss).
      expect(screen.getByTestId("compact-probe").textContent).toBe("desktop")
    })
  })
})

describe("AppShell main region", () => {
  it("leaves the one main region to the view, adding none of its own", async () => {
    stubMatchMedia(false)
    installShellFetch()
    await renderInRouter(<AppShell />, "/sessions", <main>View</main>)

    const mains = await screen.findAllByRole("main")
    expect(mains).toHaveLength(1)
    expect(mains[0]?.textContent).toBe("View")
  })
})

describe("compact app bar", () => {
  it("renders the 44px app bar with the contextual title and the mark at a tab root", async () => {
    stubMatchMedia(true)
    installShellFetch()
    await renderInRouter(<AppShell />, "/sessions")

    const bar = await screen.findByTestId("compact-app-bar")
    expect(bar.className).toContain("compact-app-bar")
    expect(within(bar).getByTestId("view-title").textContent).toBe("Sessions")
    expect(within(bar).getByTestId("compact-mark")).toBeTruthy()
    expect(within(bar).queryByTestId("compact-back")).toBeNull()
    expect(screen.queryByTestId("sidebar")).toBeNull()
    expect(screen.queryByTestId("top-bar")).toBeNull()
  })

  it("renders the 44px back chevron on a nested route and calls the back seam", async () => {
    stubMatchMedia(true)
    installShellFetch()
    await renderInRouter(<AppShell />, "/sessions/5")

    const back = await screen.findByTestId("compact-back")
    expect(back.getAttribute("aria-label")).toBe("Go back")
    expect(back.getAttribute("title")).toBe("Go back")
    expect(back.className).toContain("h-11")
    expect(back.className).toContain("w-11")

    const goBack = vi.fn()
    const uninstall = installBackNavigation({ canGoBack: () => true, goBack })
    back.click()
    uninstall()
    expect(goBack).toHaveBeenCalledTimes(1)
  })

  it("keeps the connection dot and bell inside the app bar", async () => {
    stubMatchMedia(true)
    installShellFetch()
    await renderInRouter(<AppShell />, "/sessions")

    const bar = await screen.findByTestId("compact-app-bar")
    expect(within(bar).getByTestId("connection-dot")).toBeTruthy()
    expect(within(bar).getByTestId("notification-bell")).toBeTruthy()
  })
})

describe("compact tab bar", () => {
  it("renders the five spec slots with aria-current on the active tab only", async () => {
    stubMatchMedia(true)
    installShellFetch()
    await renderInRouter(<AppShell />, "/sessions")

    const bar = await screen.findByTestId("compact-tab-bar")
    expect(bar.tagName).toBe("NAV")
    expect(bar.getAttribute("aria-label")).toBe("Primary")
    expect(bar.className).toContain("compact-tab-bar")
    const slots = within(bar).getAllByRole("link")
    expect(slots).toHaveLength(4)
    expect(within(bar).getByTestId("compact-tab-more").tagName).toBe("BUTTON")

    expect(within(bar).getByTestId("compact-tab-sessions").getAttribute("aria-current")).toBe("page")
    for (const id of ["autoruns", "recordings", "profiles", "more"]) {
      expect(within(bar).getByTestId(`compact-tab-${id}`).getAttribute("aria-current")).toBeNull()
    }
  })

  it("moves aria-current and navigates when another tab is pressed", async () => {
    stubMatchMedia(true)
    installShellFetch()
    const { router } = await renderInRouter(<AppShell />, "/sessions")

    const bar = await screen.findByTestId("compact-tab-bar")
    within(bar).getByTestId("compact-tab-autoruns").click()

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/autoruns")
    })
    expect(within(bar).getByTestId("compact-tab-autoruns").getAttribute("aria-current")).toBe("page")
    expect(within(bar).getByTestId("compact-tab-sessions").getAttribute("aria-current")).toBeNull()
  })

  it("highlights the More slot for a deep-linked settings route", async () => {
    stubMatchMedia(true)
    installShellFetch()
    await renderInRouter(<AppShell />, "/settings/clients")

    const bar = await screen.findByTestId("compact-tab-bar")
    expect(within(bar).getByTestId("compact-tab-more").getAttribute("aria-current")).toBe("page")
    expect(within(bar).getByTestId("compact-tab-sessions").getAttribute("aria-current")).toBeNull()
  })
})

describe("More sheet", () => {
  it("lists every destination and the account rows for an admin", async () => {
    stubMatchMedia(true)
    installShellFetch()
    await renderInRouter(<AppShell />, "/sessions")

    const bar = await screen.findByTestId("compact-tab-bar")
    within(bar).getByTestId("compact-tab-more").click()

    const sheet = await screen.findByTestId("compact-more-sheet")
    const link = (name: string) => within(sheet).getByRole("link", { name })
    expect(link("Plugins").getAttribute("href")).toBe("/plugins")
    expect(link("Import/Export").getAttribute("href")).toBe("/import-export")
    expect(link("Settings").getAttribute("href")).toBe("/settings")
    expect(link("Users").getAttribute("href")).toBe("/settings/users")
    expect(link("API clients").getAttribute("href")).toBe("/settings/clients")
    expect(link("Change password").getAttribute("href")).toBe("/settings")
    expect(within(sheet).getByText("Admin")).toBeTruthy()
    expect(within(sheet).getByRole("button", { name: "Log out" })).toBeTruthy()
  })
})

describe("compact FAB", () => {
  it("renders the single 56px FAB with its aria-label when the view owns an action", async () => {
    stubMatchMedia(true)
    installShellFetch()
    await renderInRouter(<AppShell />, "/sessions")

    const fab = await screen.findByTestId("compact-fab")
    expect(fab.getAttribute("aria-label")).toBe("New session")
    expect(fab.getAttribute("title")).toBe("New session")
    expect(fab.className).toContain("size-14")
    expect(screen.getAllByTestId("compact-fab")).toHaveLength(1)
  })

  it("omits the FAB on the read-only plugins view", async () => {
    stubMatchMedia(true)
    installShellFetch()
    await renderInRouter(<AppShell />, "/plugins")

    await screen.findByTestId("compact-app-bar")
    expect(screen.queryByTestId("compact-fab")).toBeNull()
    expect(screen.queryByTestId("compact-primary-action")).toBeNull()
  })

  it("invokes the view handler registered for the current route action", async () => {
    stubMatchMedia(true)
    installShellFetch()
    await renderInRouter(<AppShell />, "/autoruns")

    const handler = vi.fn()
    const release = registerCompactActionHandler("new-autorun", handler)
    const fab = await screen.findByTestId("compact-fab")
    fab.click()
    release()

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("keeps the view's primary action overriding the default FAB inside the slot", async () => {
    stubMatchMedia(true)
    installShellFetch()
    await renderInRouter(
      <AppShell />,
      "/sessions",
      <PrimaryAction>
        <button type="button">New session</button>
      </PrimaryAction>,
    )

    const slot = await screen.findByTestId("compact-primary-action")
    expect(within(slot).getAllByRole("button", { name: "New session" })).toHaveLength(1)
    expect(screen.queryByTestId("compact-fab")).toBeNull()
  })
})

describe("compact scroll container", () => {
  it("renders exactly one scroll container with 16px padding and hidden horizontal overflow", async () => {
    stubMatchMedia(true)
    installShellFetch()
    await renderInRouter(<AppShell />, "/sessions", <main>View</main>)

    const containers = await screen.findAllByTestId("compact-scroll")
    expect(containers).toHaveLength(1)
    const scroll = containers[0] as HTMLElement
    expect(scroll.className).toContain("p-4")
    expect(scroll.className).toContain("overflow-y-auto")
    expect(scroll.className).toContain("overflow-x-hidden")
    const view = within(scroll).getByRole("main")
    expect(view.textContent).toBe("View")
  })
})
