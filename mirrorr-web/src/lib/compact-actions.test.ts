/**
 * Todo 24 FAB invocation seam: the shell owns the 56px FAB, the per-view
 * handler is registered by the owner of the action (todo 26 wires V3/V5/V12/
 * V13 onto this registry, `D1`/`D2` and the settings dialogs remain the
 * implementations). The shell never imports a view.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { invokeCompactAction, registerCompactActionHandler } from "@/lib/compact-actions"

const releases: Array<() => void> = []

function register(id: Parameters<typeof registerCompactActionHandler>[0], handler: () => void): () => void {
  const release = registerCompactActionHandler(id, handler)
  releases.push(release)
  return release
}

afterEach(() => {
  while (releases.length > 0) releases.pop()?.()
})

describe("compact FAB action registry", () => {
  it("invokes the registered handler and reports the action as handled", () => {
    const handler = vi.fn()
    register("new-session", handler)

    expect(invokeCompactAction("new-session")).toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("reports an action with no handler as unhandled instead of throwing", () => {
    expect(invokeCompactAction("new-key")).toBe(false)
  })

  it("keeps actions isolated: a handler for one id never serves another", () => {
    const handler = vi.fn()
    register("new-user", handler)

    expect(invokeCompactAction("new-session")).toBe(false)
    expect(handler).not.toHaveBeenCalled()
  })

  it("lets the newest registration replace an older one and keeps release identity-safe", () => {
    const first = vi.fn()
    const second = vi.fn()
    const releaseFirst = register("new-autorun", first)
    const releaseSecond = register("new-autorun", second)

    expect(invokeCompactAction("new-autorun")).toBe(true)
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()

    releaseFirst()
    expect(invokeCompactAction("new-autorun")).toBe(true)
    expect(second).toHaveBeenCalledTimes(2)

    releaseSecond()
    expect(invokeCompactAction("new-autorun")).toBe(false)
  })
})
