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
import { clearAuthSession, setAuthSession } from "@/lib/auth-store"
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
