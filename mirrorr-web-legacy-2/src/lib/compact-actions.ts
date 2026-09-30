/**
 * The FAB invocation registry (spec L497). The compact shell owns the single
 * 56px FAB; the view that owns the action registers its handler here, so the
 * shell never imports a view and chrome/view cannot fork. Todo 26 registers
 * V3 "new-session", V5 "new-autorun", V8 "new-profile", V12 "new-user" and
 * V13 "new-key" onto the existing D1/D2/settings dialogs.
 */
import type { CompactFabActionId } from "@/lib/compact-nav"

const handlers = new Map<CompactFabActionId, () => void>()

/**
 * Registers `handler` for `id` and returns an idempotent release. Registering
 * again replaces the previous handler (StrictMode's double mount is safe); a
 * release only clears the entry when it still owns it.
 */
export function registerCompactActionHandler(id: CompactFabActionId, handler: () => void): () => void {
  handlers.set(id, handler)

  return () => {
    if (handlers.get(id) === handler) handlers.delete(id)
  }
}

/** Returns `true` when a handler ran, `false` when the action is unowned. */
export function invokeCompactAction(id: CompactFabActionId): boolean {
  const handler = handlers.get(id)
  if (handler === undefined) return false
  handler()
  return true
}
