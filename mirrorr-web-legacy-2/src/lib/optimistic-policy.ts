/**
 * The per-action optimistic policies — the exact table in
 * `docs/web-frontend-spec.md` L141-L150, and the plan's policy summary.
 *
 * | Action            | Optimistic?                          | Settles on                          | On failure                          |
 * |-------------------|--------------------------------------|-------------------------------------|-------------------------------------|
 * | create            | NO (server assigns id/status)        | mutation response inserted          | rethrow (view renders form errors)  |
 * | stop              | pending-only (no field guess)        | WS `*.updated` clears the pending   | clear + rethrow                     |
 * | recording toggle  | pending overlay + revert on 400/409  | WS status flip clears the pending   | 400/409 → drop the overlay, rethrow |
 * | delete            | pending-only, waits for the WS event | WS `*.deleted`; 15s poll fallback   | clear + rethrow                     |
 * | mark-read         | pending overlay (badge arithmetic)   | authoritative response/snapshot     | drop overlay + toast + rethrow      |
 *
 * None of these write optimistic fields into the entity cache: the overlay
 * lives in the store's pending map and disappears when an authoritative
 * snapshot (or a revert) clears it.
 */
import type { EntityResource, EntityStore } from "@/lib/entity-store"
import type { EntityValues } from "@/lib/entity-merge"
import { ApiError } from "@/lib/errors"
import { showToast } from "@/lib/toast"

/** The spec's delete fallback: poll while the WS `deleted` event is missing. */
export const DELETE_POLL_FALLBACK_MS = 15_000

/** The ONLY statuses that revert the recording toggle (spec L150). */
export const RECORDING_TOGGLE_REVERT_STATUSES: readonly number[] = [400, 409]

function shouldRevertRecordingToggle(error: unknown): boolean {
  return error instanceof ApiError && RECORDING_TOGGLE_REVERT_STATUSES.includes(error.status)
}

export interface CreateEntitySpec<T extends EntityValues> {
  readonly resource: EntityResource
  /** The real POST; its parsed response is the entity to insert. */
  readonly mutate: () => Promise<T>
}

/**
 * Create is NOT optimistic (the server assigns the id): no pending entry and
 * no cache write until the mutation resolves. The resolved response goes
 * through the insert-only precedence, so a WS echo that raced ahead stays the
 * single row and keeps its newer fields.
 */
export async function createEntity<T extends EntityValues>(
  store: EntityStore,
  spec: CreateEntitySpec<T>,
): Promise<T> {
  const entity = await spec.mutate()
  store.applyMutationResponse(spec.resource, entity)
  return entity
}

export interface StopEntitySpec {
  readonly resource: EntityResource
  readonly id: number
  readonly mutate: () => Promise<void>
}

/**
 * Stop is pending-only: the button shows "Stopping…" (the pending entry) and
 * NO local status is guessed. The entry survives success until a WS
 * `*.updated` snapshot for the id clears it. A failed request clears it.
 */
export async function stopEntity(store: EntityStore, spec: StopEntitySpec): Promise<void> {
  const ticket = store.beginPending(spec.resource, spec.id, { kind: "stop" })
  try {
    await spec.mutate()
  } catch (error) {
    ticket.clear()
    throw error
  }
}

export interface ToggleRecordingSpec {
  readonly resource: EntityResource
  readonly id: number
  /** The overlay value(s) the UI renders while the toggle is in flight. */
  readonly optimisticFields: Readonly<Record<string, unknown>>
  readonly mutate: () => Promise<void>
}

/**
 * Recording enable/disable: the toggle flips optimistically via the pending
 * overlay and reverts ONLY on 400/409, where the server authoritatively
 * rejected the flip. Any other failure leaves the overlay for the WS/refetch
 * flow to settle.
 */
export async function toggleRecording(
  store: EntityStore,
  spec: ToggleRecordingSpec,
): Promise<void> {
  const ticket = store.beginPending(spec.resource, spec.id, {
    kind: "recording-toggle",
    fields: spec.optimisticFields,
  })
  try {
    await spec.mutate()
  } catch (error) {
    if (shouldRevertRecordingToggle(error)) ticket.clear()
    throw error
  }
}

export interface DeleteEntitySpec {
  readonly resource: EntityResource
  readonly id: number
  /** The real DELETE request. */
  readonly mutate: () => Promise<void>
  readonly pollFallbackMs?: number
}

/**
 * Delete: pending-only — the row stays visible (disabled/with a spinner) and
 * is removed only by the WS `*.deleted` frame, which also cancels the pending
 * entry. While the frame is missing, a 15s poll fallback refetches the entity
 * until it disappears.
 */
export async function deleteEntity(store: EntityStore, spec: DeleteEntitySpec): Promise<void> {
  const ticket = store.beginPending(spec.resource, spec.id, { kind: "delete" })
  try {
    await spec.mutate()
  } catch (error) {
    ticket.clear()
    throw error
  }

  ticket.schedulePollFallback(
    () => {
      void store.scheduleRefetch(spec.resource, spec.id)
    },
    spec.pollFallbackMs ?? DELETE_POLL_FALLBACK_MS,
  )
}

export interface MarkReadSpec {
  readonly resource: EntityResource
  readonly id: number
  /** e.g. `{read: true}` — the badge arithmetic reads this overlay. */
  readonly optimisticFields: Readonly<Record<string, unknown>>
  /**
   * The real mark-read call. Return the authoritative entity when the server
   * sends one; return `undefined` for a 204 and the view's refetch settles it.
   */
  readonly mutate: () => Promise<EntityValues | undefined>
  /** Toast copy for a failed mark-read (the view owns the wording). */
  readonly rollbackMessage: string
  /** Injectable for tests; defaults to the shared Toast store (todo 9). */
  readonly notify?: (message: string) => void
}

/**
 * Mark-read is optimistic: the overlay moves the badge while the request is in
 * flight. On failure the overlay is dropped (the previous value comes back)
 * and the failure is toasted. On success the authoritative entity, when
 * present, replaces the overlay in one write.
 */
export async function markRead(store: EntityStore, spec: MarkReadSpec): Promise<void> {
  const ticket = store.beginPending(spec.resource, spec.id, {
    kind: "mark-read",
    fields: spec.optimisticFields,
  })

  try {
    const entity = await spec.mutate()
    if (ticket.cancelled) return
    if (entity === undefined) {
      ticket.clear()
      return
    }
    store.applyAuthoritativeSnapshot(
      spec.resource,
      spec.id,
      { ...entity, id: spec.id },
      { insert: false },
    )
  } catch (error) {
    if (!ticket.cancelled) {
      ticket.clear()
      ;(spec.notify ?? showToast)(spec.rollbackMessage)
    }
    throw error
  }
}
