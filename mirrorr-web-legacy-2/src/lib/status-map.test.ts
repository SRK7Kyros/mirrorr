import { afterEach, describe, expect, it, vi } from "vitest"
import {
  AUTORUN_STATUSES,
  SESSION_STATUSES,
  STATUS_KEYS,
  STATUS_MAP,
  autorunActionsFor,
  resolveStatus,
  sessionActionsFor,
} from "./status-map"

/**
 * The Status & Lifecycle Map is the single source of truth for status labels,
 * colours, dots and action sets (docs/web-frontend-spec.md L193-L213): no view
 * may restate status semantics, and the map wins over per-view prose.
 */

afterEach(() => {
  vi.restoreAllMocks()
})

function actionIds(actions: readonly { readonly id: string }[]): string[] {
  return actions.map((action) => action.id)
}

describe("STATUS_MAP", () => {
  it("exports exactly nine statuses including the unknown fallback", () => {
    expect(STATUS_KEYS).toHaveLength(9)
    expect(STATUS_KEYS).toContain("unknown")
    expect(STATUS_MAP.unknown.label).toBe("Unknown")
    expect(STATUS_MAP.unknown.colorToken).toBe("--neutral")
  })

  it("maps every session status (7) to a non-unknown entry", () => {
    expect(SESSION_STATUSES).toHaveLength(7)
    for (const status of SESSION_STATUSES) {
      const resolved = resolveStatus(status)
      expect(resolved.key).toBe(status)
      expect(resolved.isUnknown).toBe(false)
      expect(resolved.entry.label).not.toBe("Unknown")
      expect(resolved.entry.label.length).toBeGreaterThan(0)
    }
  })

  it("maps every autorun status (8) to a non-unknown entry", () => {
    expect(AUTORUN_STATUSES).toHaveLength(8)
    for (const status of AUTORUN_STATUSES) {
      const resolved = resolveStatus(status)
      expect(resolved.key).toBe(status)
      expect(resolved.isUnknown).toBe(false)
      expect(resolved.entry.label).not.toBe("Unknown")
    }
  })

  it("covers the spec labels, colour tokens and dots", () => {
    expect(STATUS_MAP.scheduled).toMatchObject({ label: "Scheduled", colorToken: "--info", dot: "static" })
    expect(STATUS_MAP.active).toMatchObject({ label: "Running", colorToken: "--ok", dot: "static" })
    expect(STATUS_MAP.recording).toMatchObject({ label: "Recording", colorToken: "--danger", dot: "pulse" })
    expect(STATUS_MAP.terminating).toMatchObject({ label: "Stopping…", colorToken: "--warn", dot: "static" })
    expect(STATUS_MAP.remuxing).toMatchObject({ label: "Remuxing", colorToken: "--purple", dot: "spinner" })
    expect(STATUS_MAP.finalizing).toMatchObject({ label: "Finalizing", colorToken: "--purple", dot: "spinner" })
    expect(STATUS_MAP.completed).toMatchObject({ label: "Completed", colorToken: "--ok", dot: "check" })
    expect(STATUS_MAP.failed).toMatchObject({ label: "Failed", colorToken: "--danger", dot: "cross" })
    expect(STATUS_MAP.unknown).toMatchObject({ label: "Unknown", colorToken: "--neutral", dot: "static" })
  })

  it("withholds delete on remuxing/finalizing for sessions and autoruns", () => {
    for (const status of ["remuxing", "finalizing"] as const) {
      expect(actionIds(sessionActionsFor(status))).not.toContain("delete")
      expect(actionIds(autorunActionsFor(status))).not.toContain("delete")
      expect(sessionActionsFor(status)).toHaveLength(0)
      expect(autorunActionsFor(status)).toHaveLength(0)
    }

    expect(actionIds(sessionActionsFor("completed"))).toContain("delete")
    expect(actionIds(sessionActionsFor("failed"))).toContain("delete")
    expect(actionIds(sessionActionsFor("unknown"))).toContain("delete")
    expect(actionIds(autorunActionsFor("completed"))).toContain("delete")
  })

  it("keeps the recording toggle visible but disabled when can_record is false", () => {
    const disabled = sessionActionsFor("active", { canRecord: false })
    const toggle = disabled.find((action) => action.id === "toggle-recording")
    expect(toggle).toBeDefined()
    expect(toggle?.disabled).toBe(true)
    expect(toggle?.label).toBe("Enable recording")

    const enabled = sessionActionsFor("active", { canRecord: true })
    expect(enabled.find((action) => action.id === "toggle-recording")?.disabled).toBe(false)

    const recording = sessionActionsFor("recording", { canRecord: true })
    expect(recording.find((action) => action.id === "toggle-recording")?.label).toBe("Disable recording")
  })

  it("renders the terminating stop action disabled instead of hiding it", () => {
    const stop = sessionActionsFor("terminating").find((action) => action.id === "stop")
    expect(stop).toBeDefined()
    expect(stop?.disabled).toBe(true)
  })

  it("exposes the spec action sets per kind", () => {
    expect(actionIds(autorunActionsFor("scheduled"))).toEqual(["edit", "delete", "run-now"])
    expect(actionIds(sessionActionsFor("active"))).toEqual(["stop", "toggle-recording", "delete"])
    expect(actionIds(sessionActionsFor("recording"))).toEqual(["stop", "toggle-recording", "delete"])
    expect(actionIds(autorunActionsFor("active"))).toEqual(["edit", "delete"])
    expect(actionIds(autorunActionsFor("terminating"))).toEqual(["delete"])
    expect(actionIds(sessionActionsFor("scheduled"))).toEqual([])
    const emptyDelete = sessionActionsFor("active").find((action) => action.id === "delete")
    expect(emptyDelete?.overflow).toBe(true)
  })

  it("falls back to the unknown entry for an unrecognized status and warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    const resolved = resolveStatus("bogus_status_xyz")
    expect(resolved.isUnknown).toBe(true)
    expect(resolved.key).toBe("unknown")
    expect(resolved.raw).toBe("bogus_status_xyz")
    expect(resolved.entry.label).toBe("Unknown")
    expect(warn).toHaveBeenCalledTimes(1)

    // Rendering the same unrecognized string again must not spam the console.
    resolveStatus("bogus_status_xyz")
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
