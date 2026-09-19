/**
 * The session-frame channel: the seam between Wave 3's real socket (todo 18)
 * and the open V4 detail view.
 *
 * Contract: `docs/web-frontend-spec.md` L179-L181 (the frame → cache reactions)
 * and L283 (the V4 WS row). The socket parses `/ws/events` frames and publishes
 * them here; the open detail is the only subscriber today and routes each frame
 * through the entity store (`EntityStore.applyFrame`) or the remux-progress
 * store — a view never re-implements the merge precedence. List/global frames
 * are todo 19's concern; this channel exists so the detail's actions
 * (`session.deleted` → navigate, `session.crashed` → toast) have a defined
 * delivery point until the socket lands.
 */
import type { EntityFrame } from "@/lib/entity-store"

type SessionFrameListener = (frame: EntityFrame) => void

const listeners = new Set<SessionFrameListener>()

/** Wave 3's socket publishes every parsed session-family frame here. */
export function publishSessionFrame(frame: EntityFrame): void {
  for (const listener of [...listeners]) listener(frame)
}

/** The open detail subscribes; the returned function unsubscribes. */
export function subscribeSessionFrames(listener: SessionFrameListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** `session.{id}.remux.progress` — the only subject the entity store must not merge. */
export function isRemuxProgressEvent(event: string): boolean {
  return event.endsWith(".remux.progress")
}
