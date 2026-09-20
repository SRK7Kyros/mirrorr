/**
 * Todo 25 (spec L506): swipe-down dismisses sheets/drawers.
 *
 * Drag-down-only: an upward or sideways drag is not a dismissal, and the only
 * consequence of the gesture is the same `onClose` the close button, the
 * overlay click and Esc already run — no gesture mutates data. The spec fixes
 * no distance, so the threshold matches the pull-to-refresh one (64px) rather
 * than inventing a second number.
 */
export const SHEET_DISMISS_THRESHOLD_PX = 64

export function sheetDragDistance(startY: number, currentY: number): number {
  return Math.max(0, currentY - startY)
}

export function shouldDismissSheet(startY: number, currentY: number): boolean {
  return sheetDragDistance(startY, currentY) >= SHEET_DISMISS_THRESHOLD_PX
}
