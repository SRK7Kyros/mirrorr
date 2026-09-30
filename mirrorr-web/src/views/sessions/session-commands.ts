import { useCallback, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/components/ui/Toast"
import { ApiError } from "@/lib/api"
import { queryKeys, queryRoots } from "@/lib/query-keys"
import type { Session } from "@/lib/schemas"
import {
  deleteSession,
  saveSessionAsProfile,
  setSessionRecording,
  stopSession,
} from "@/views/shared/api"
import { removeFromInfiniteLists } from "@/views/shared/hooks"

/**
 * Session row/detail command state + mutations. Optimistic policy is
 * pending-only for stop/record toggle (contract: no local status write);
 * delete keeps the row in a "Deleting…" state after 204 until `session.deleted`
 * WS removal or the 15s poll confirms — 204 ≠ gone.
 */

export interface SessionCommandState {
  readonly stopPending: boolean
  readonly stillStopping: boolean
  readonly recPending: boolean
  readonly recTarget: boolean | null
  readonly deletePending: boolean
  readonly deleting: boolean
  readonly controlError: string | null
}

const EMPTY_STATE: SessionCommandState = {
  stopPending: false,
  stillStopping: false,
  recPending: false,
  recTarget: null,
  deletePending: false,
  deleting: false,
  controlError: null,
}

const STOP_CONFIRM_WAIT_MS = 10_000
const DELETE_CONFIRM_WAIT_MS = 15_000

function isControlFailure(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 502 || error.status === 504)
}

export interface SessionCommands {
  readonly stateOf: (id: number) => SessionCommandState
  readonly stop: (session: Session) => Promise<void>
  readonly toggleRecording: (session: Session) => Promise<void>
  readonly remove: (session: Session) => Promise<void>
  readonly saveAsProfile: (session: Session, name: string) => Promise<boolean>
  readonly acknowledgeStatus: (session: Session) => void
  readonly clearControlError: (id: number) => void
}

export function useSessionCommands(): SessionCommands {
  const client = useQueryClient()
  const { toast } = useToast()
  const [states, setStates] = useState<Record<number, SessionCommandState>>({})
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const patch = useCallback((id: number, next: Partial<SessionCommandState>) => {
    setStates((current) => ({ ...current, [id]: { ...(current[id] ?? EMPTY_STATE), ...next } }))
  }, [])

  const stateOf = useCallback((id: number) => states[id] ?? EMPTY_STATE, [states])

  const schedule = useCallback((key: string, delay: number, fn: () => void) => {
    const existing = timers.current.get(key)
    if (existing !== undefined) clearTimeout(existing)
    timers.current.set(
      key,
      setTimeout(() => {
        timers.current.delete(key)
        fn()
      }, delay),
    )
  }, [])

  const stop = useCallback(
    async (session: Session) => {
      patch(session.id, { stopPending: true, stillStopping: false, controlError: null })
      try {
        await stopSession(session.id)
        // Pending-only: chip shows "Stopping…" locally until WS confirms.
        schedule(`stop-${session.id}`, STOP_CONFIRM_WAIT_MS, () => {
          patch(session.id, { stillStopping: true })
        })
      } catch (error) {
        patch(session.id, { stopPending: false })
        if (isControlFailure(error)) {
          patch(session.id, { controlError: "Control unavailable — session may be stuck" })
        } else {
          toast({
            kind: "error",
            title: "Could not stop session",
            body: error instanceof ApiError ? error.message : undefined,
          })
        }
      }
    },
    [patch, schedule, toast],
  )

  const toggleRecording = useCallback(
    async (session: Session) => {
      const target = session.recording !== true
      patch(session.id, { recPending: true, recTarget: target })
      try {
        await setSessionRecording(session.id, target)
        // 10s timeout → refetch the session and drop the pending state.
        schedule(`rec-${session.id}`, 10_000, () => {
          void client.invalidateQueries({ queryKey: queryKeys.session(session.id) })
          void client.invalidateQueries({ queryKey: queryRoots.sessions })
          patch(session.id, { recPending: false, recTarget: null })
        })
      } catch (error) {
        patch(session.id, { recPending: false, recTarget: null })
        toast({
          kind: "error",
          title: "Recording toggle failed",
          body: error instanceof ApiError ? error.message : undefined,
        })
      }
    },
    [client, patch, schedule, toast],
  )

  const remove = useCallback(
    async (session: Session) => {
      patch(session.id, { deletePending: true, controlError: null })
      try {
        await deleteSession(session.id)
        // 204 ≠ gone — row stays in "Deleting…" until session.deleted WS or poll.
        patch(session.id, { deletePending: false, deleting: true })
        schedule(`del-${session.id}`, DELETE_CONFIRM_WAIT_MS, () => {
          void client.invalidateQueries({ queryKey: queryRoots.sessions })
          removeFromInfiniteLists(client, queryRoots.sessions, session.id)
        })
      } catch (error) {
        patch(session.id, { deletePending: false })
        const detail = error instanceof ApiError ? error.message : "Delete failed"
        toast({
          kind: "error",
          title: error instanceof ApiError && error.status === 409 ? "Cannot delete while remuxing" : "Delete failed",
          body: detail,
        })
      }
    },
    [client, patch, schedule, toast],
  )

  const saveAsProfile = useCallback(
    async (session: Session, name: string): Promise<boolean> => {
      try {
        await saveSessionAsProfile(session.id, name)
        void client.invalidateQueries({ queryKey: queryRoots.profiles })
        toast({ kind: "success", title: `Profile '${name}' saved` })
        return true
      } catch (error) {
        toast({
          kind: "error",
          title: "Save as profile failed",
          body: error instanceof ApiError ? error.message : undefined,
        })
        return false
      }
    },
    [client, toast],
  )

  /** Row effect hook: clears pending labels once an authoritative snapshot lands. */
  const acknowledgeStatus = useCallback(
    (session: Session) => {
      const current = states[session.id]
      if (current === undefined) return
      let next: Partial<SessionCommandState> = {}
      if (
        current.stopPending &&
        (session.status === "terminating" ||
          session.status === "completed" ||
          session.status === "failed" ||
          session.status === "remuxing" ||
          session.status === "finalizing")
      ) {
        next = { ...next, stopPending: false, stillStopping: false }
        const timer = timers.current.get(`stop-${session.id}`)
        if (timer !== undefined) {
          clearTimeout(timer)
          timers.current.delete(`stop-${session.id}`)
        }
      }
      if (current.recPending && current.recTarget !== null && session.recording === current.recTarget) {
        next = { ...next, recPending: false, recTarget: null }
      }
      if (Object.keys(next).length > 0) patch(session.id, next)
    },
    [patch, states],
  )

  const clearControlError = useCallback(
    (id: number) => {
      patch(id, { controlError: null })
    },
    [patch],
  )

  return { stateOf, stop, toggleRecording, remove, saveAsProfile, acknowledgeStatus, clearControlError }
}
