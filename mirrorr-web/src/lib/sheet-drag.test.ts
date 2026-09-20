/**
 * Todo 25 (spec L506): swipe-down dismissal is drag-down-only and cannot be
 * triggered by an upward or sideways drag.
 */
import { describe, expect, it } from "vitest"
import {
  SHEET_DISMISS_THRESHOLD_PX,
  sheetDragDistance,
  shouldDismissSheet,
} from "@/lib/sheet-drag"

describe("sheet drag dismissal", () => {
  it("dismisses only after a downward drag of the threshold", () => {
    expect(SHEET_DISMISS_THRESHOLD_PX).toBe(64)
    expect(shouldDismissSheet(200, 200 + 63)).toBe(false)
    expect(shouldDismissSheet(200, 200 + 64)).toBe(true)
  })

  it("never dismisses on an upward or sideways drag", () => {
    expect(sheetDragDistance(200, 100)).toBe(0)
    expect(shouldDismissSheet(200, 100)).toBe(false)
    expect(shouldDismissSheet(200, 200)).toBe(false)
  })
})
