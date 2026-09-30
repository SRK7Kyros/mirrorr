/**
 * Spec L497: lets a view own the compact shell's single 56px FAB action without
 * the shell importing the view. The latest handler is held in a ref so the
 * registration effect runs once per action id rather than on every render.
 */
import { useEffect, useRef } from "react"
import { registerCompactActionHandler } from "@/lib/compact-actions"
import type { CompactFabActionId } from "@/lib/compact-nav"

export function useCompactAction(id: CompactFabActionId, handler: () => void): void {
  const latest = useRef(handler)
  latest.current = handler

  useEffect(() => registerCompactActionHandler(id, () => latest.current()), [id])
}
