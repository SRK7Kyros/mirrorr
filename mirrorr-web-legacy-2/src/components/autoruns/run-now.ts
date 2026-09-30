/**
 * "Run now" for autoruns — spec L285: no run endpoint exists, so the client
 * composes `POST /sessions/` from the autorun's engine/resolver/config/retry
 * copy, toasts, and navigates to the spawned session (§13.3).
 */
import { buildRunNowSessionBody } from "@/lib/autoruns-api"
import type { EntityStore } from "@/lib/entity-store"
import { userMessageForError } from "@/lib/errors"
import { createEntity } from "@/lib/optimistic-policy"
import type { Autorun } from "@/lib/schemas/autoruns"
import { createSession } from "@/lib/sessions-api"
import { showToast } from "@/lib/toast"

export async function runAutorunNow(store: EntityStore, autorun: Autorun): Promise<void> {
  try {
    const session = await createEntity(store, {
      resource: "session",
      mutate: () => createSession(buildRunNowSessionBody(autorun)),
    })
    showToast("Session started", "info")
    window.location.assign(`/sessions/${session.id}`)
  } catch (caught) {
    showToast(userMessageForError(caught))
  }
}
