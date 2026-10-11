import type { InfiniteData, QueryClient } from "@tanstack/react-query"
import {
  applyAuthoritative,
  clearPendingActions,
  idKey,
  type EntityId,
  type Identified,
} from "@/api/entity-store"
import { queryKeys, queryRoots, type CursorPage } from "@/api/query-keys"
import { setRealtimeFrameHandlers } from "@/api/realtime/manager"
import { queryClient as defaultQueryClient } from "@/api/query-client"
import { removeFromInfiniteLists } from "@/api/infinite-lists"

export interface EventToast {
  readonly kind: "info" | "success" | "error"
  readonly message: string
  readonly action?: { readonly label: string; readonly to: string }
}

export interface EventTableOptions {
  readonly navigate?: (to: string) => void
  readonly toast?: (toast: EventToast) => void
}

export interface EventTable {
  handleFrame(frame: unknown): void
  dispose(): void
}

export interface RemuxProgress {
  readonly percent: number
  readonly eta_seconds?: number
  readonly speed?: number
}

type RemuxListener = (progress: RemuxProgress) => void

const remuxListeners = new Map<number, Set<RemuxListener>>()

export function subscribeRemuxProgress(sessionId: number, listener: RemuxListener): () => void {
  const set = remuxListeners.get(sessionId) ?? new Set<RemuxListener>()
  set.add(listener)
  remuxListeners.set(sessionId, set)
  return () => {
    const current = remuxListeners.get(sessionId)
    if (current === undefined) return
    current.delete(listener)
    if (current.size === 0) remuxListeners.delete(sessionId)
  }
}

const COALESCE_MS = 30
const REMUX_PATTERN = /^session\.(\d+)\.remux\.progress$/

type AnyEntity = Identified & Record<string, unknown>

interface ParsedFrame {
  readonly event: string
  readonly id?: number | string
  readonly data?: unknown
  readonly [key: string]: unknown
}

function parseFrame(frame: unknown): ParsedFrame | null {
  if (frame === null || typeof frame !== "object") return null
  const record = frame as Record<string, unknown>
  if (typeof record.event !== "string") return null
  return record as ParsedFrame
}

function frameEntityId(frame: ParsedFrame): EntityId | undefined {
  if (typeof frame.id === "number" || typeof frame.id === "string") return frame.id
  const data = frame.data
  if (data !== null && typeof data === "object") {
    const id = (data as { id?: unknown }).id
    if (typeof id === "number" || typeof id === "string") return id
  }
  return undefined
}

function entityFromData(frame: ParsedFrame): AnyEntity | null {
  const data = frame.data
  if (data === null || typeof data !== "object") return null
  const entity = data as { id?: unknown }
  if (typeof entity.id !== "number" && typeof entity.id !== "string") return null
  return data as AnyEntity
}

function publishRemux(sessionId: number, frame: ParsedFrame): void {
  const listeners = remuxListeners.get(sessionId)
  if (listeners === undefined || listeners.size === 0) return
  const source = frame.data !== null && typeof frame.data === "object" ? frame.data : frame
  const record = source as Record<string, unknown>
  if (typeof record.percent !== "number") {
    console.warn("Remux progress frame missing percent", frame)
    return
  }
  const progress: RemuxProgress = {
    percent: record.percent,
    ...(typeof record.eta_seconds === "number" ? { eta_seconds: record.eta_seconds } : {}),
    ...(typeof record.speed === "number" ? { speed: record.speed } : {}),
  }
  for (const listener of [...listeners]) listener(progress)
}

export function createEventTable(client: QueryClient, options: EventTableOptions = {}): EventTable {
  const buffer = new Map<string, ParsedFrame>()
  let flushTimer: ReturnType<typeof setTimeout> | null = null

  // Rule 5 is sticky for this table's lifetime: a deleted id stays deleted so a
  // later stale `*.updated` cannot resurrect it; a `*.created` clears it.
  const deletedIds = new Map<string, Set<string>>()
  function markDeleted(resource: string, id: EntityId): void {
    const ids = deletedIds.get(resource) ?? new Set<string>()
    ids.add(idKey(id))
    deletedIds.set(resource, ids)
  }
  function isDeleted(resource: string, id: EntityId): boolean {
    return deletedIds.get(resource)?.has(idKey(id)) === true
  }
  function clearDeleted(resource: string, id: EntityId): void {
    deletedIds.get(resource)?.delete(idKey(id))
  }

  function handleFrame(frame: unknown): void {
    const parsed = parseFrame(frame)
    if (parsed === null) {
      console.warn("Ignoring malformed event frame", frame)
      return
    }
    // 30ms coalesce; dedupe key = (event-family, id), newest frame wins.
    buffer.set(JSON.stringify([parsed.event, frameEntityId(parsed) ?? null]), parsed)
    if (flushTimer === null) flushTimer = setTimeout(flush, COALESCE_MS)
  }

  function flush(): void {
    flushTimer = null
    const frames = [...buffer.values()]
    buffer.clear()
    for (const frame of frames) {
      try {
        dispatch(frame)
      } catch (error) {
        console.warn("Realtime dispatch failed", error)
      }
    }
  }

  function dispose(): void {
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    buffer.clear()
  }

  function writeListPages<T extends Identified>(
    root: readonly unknown[],
    writeItems: (items: T[]) => T[],
  ): void {
    client.setQueriesData<InfiniteData<CursorPage<T>>>({ queryKey: root }, (previous) => {
      if (previous === undefined) return undefined
      return {
        ...previous,
        pages: previous.pages.map((page) => ({
          ...page,
          items: writeItems(page.items),
        })),
      }
    })
  }

  function upsertAcrossPages<T extends Identified>(root: readonly unknown[], snapshot: T): void {
    clearPendingActions(snapshot.id)
    client.setQueriesData<InfiniteData<CursorPage<T>>>({ queryKey: root }, (previous) => {
      if (previous === undefined) return undefined
      const exists = previous.pages.some((page) =>
        page.items.some((item) => item.id === snapshot.id),
      )
      let inserted = false
      const pages = previous.pages.map((page, index) => {
        if (page.items.some((item) => item.id === snapshot.id)) {
          return {
            ...page,
            items: page.items.map((item) =>
              item.id === snapshot.id ? applyAuthoritative(item, snapshot) : item,
            ),
          }
        }
        if (!exists && index === 0 && !inserted) {
          inserted = true
          return { ...page, items: [snapshot, ...page.items] }
        }
        return page
      })
      return { ...previous, pages }
    })
  }

  function upsertDetail<T extends Identified>(key: readonly unknown[], snapshot: T): void {
    client.setQueryData<T>(key, (previous) => applyAuthoritative(previous, snapshot))
  }

  function onSessionCreated(frame: ParsedFrame): void {
    const data = entityFromData(frame)
    if (data === null) {
      client.invalidateQueries({ queryKey: queryRoots.sessions })
      return
    }
    clearDeleted("session", data.id)
    upsertAcrossPages<AnyEntity>(queryRoots.sessions, data)
    const autorunId = (data as { autorun_id?: unknown }).autorun_id
    if (typeof autorunId === "number") {
      const status = typeof data.status === "string" ? data.status : undefined
      if (status !== undefined) {
        writeListPages<AnyEntity>(queryRoots.autoruns, (items) =>
          items.map((item) => (item.id === autorunId ? { ...item, status } : item)),
        )
      }
      const autorunName = typeof frame.autorun_name === "string" ? frame.autorun_name : null
      options.toast?.({
        kind: "info",
        message: autorunName === null ? "Autorun started" : `Autorun '${autorunName}' started`,
      })
    }
  }

  function onSessionUpdated(frame: ParsedFrame, refetchDetail: boolean): void {
    const data = entityFromData(frame)
    if (data === null) {
      const id = frameEntityId(frame)
      client.invalidateQueries({ queryKey: queryRoots.sessions })
      if (id !== undefined) client.invalidateQueries({ queryKey: queryKeys.session(id) })
      return
    }
    if (isDeleted("session", data.id)) return
    const previous = client.getQueryData<AnyEntity>(queryKeys.session(data.id))
    upsertDetail(queryKeys.session(data.id), data)
    upsertAcrossPages<AnyEntity>(queryRoots.sessions, data)
    const status = typeof data.status === "string" ? data.status : undefined
    if (status === "completed" && previous?.status !== "completed") {
      options.toast?.({
        kind: "info",
        message: `Session #${String(data.id)} completed`,
      })
    }
    if (status === "failed" && previous?.status !== "failed") {
      options.toast?.({
        kind: "error",
        message: `Session #${String(data.id)} failed`,
      })
      client.invalidateQueries({ queryKey: queryKeys.session(data.id) })
    } else if (refetchDetail) {
      client.invalidateQueries({ queryKey: queryKeys.session(data.id) })
    }
  }

  function onSessionDeleted(frame: ParsedFrame): void {
    const id = frameEntityId(frame)
    if (id === undefined) return
    markDeleted("session", id)
    const detailOpen = client.getQueryData(queryKeys.session(id)) !== undefined
    removeFromInfiniteLists(client, queryRoots.sessions, id)
    client.removeQueries({ queryKey: queryKeys.session(id), exact: true })
    if (detailOpen) options.navigate?.("/sessions")
  }

  function onAutorunUpsert(frame: ParsedFrame): void {
    const data = entityFromData(frame)
    if (data === null) {
      client.invalidateQueries({ queryKey: queryRoots.autoruns })
      return
    }
    if (frame.event === "autorun.created") clearDeleted("autorun", data.id)
    else if (isDeleted("autorun", data.id)) return
    upsertAcrossPages<AnyEntity>(queryRoots.autoruns, data)
    upsertDetail(queryKeys.autorun(data.id), data)
  }

  function onAutorunDeleted(frame: ParsedFrame): void {
    const id = frameEntityId(frame)
    if (id === undefined) return
    markDeleted("autorun", id)
    const detailOpen = client.getQueryData(queryKeys.autorun(id)) !== undefined
    removeFromInfiniteLists(client, queryRoots.autoruns, id)
    client.removeQueries({ queryKey: queryKeys.autorun(id), exact: true })
    if (detailOpen) options.navigate?.("/autoruns")
  }

  function onRecordingUpdated(frame: ParsedFrame): void {
    const data = entityFromData(frame)
    if (data === null) {
      client.invalidateQueries({ queryKey: queryRoots.recordings })
      return
    }
    if (isDeleted("recording", data.id)) return
    upsertAcrossPages<AnyEntity>(queryRoots.recordings, data)
  }

  function onRecordingDeleted(frame: ParsedFrame): void {
    const id = frameEntityId(frame)
    if (id === undefined) return
    markDeleted("recording", id)
    removeFromInfiniteLists(client, queryRoots.recordings, id)
  }

  function onUnknownSubject(frame: ParsedFrame): void {
    const resource = frame.event.split(".")[0] ?? ""
    const roots: Record<string, readonly unknown[]> = {
      session: queryRoots.sessions,
      autorun: queryRoots.autoruns,
      recording: queryRoots.recordings,
      profile: queryRoots.profiles,
    }
    const root = roots[resource]
    if (root !== undefined) {
      client.invalidateQueries({ queryKey: root })
      return
    }
    console.warn(`Unhandled event subject: ${frame.event}`)
  }

  function dispatch(frame: ParsedFrame): void {
    const remux = REMUX_PATTERN.exec(frame.event)
    if (remux !== null) {
      publishRemux(Number(remux[1]), frame)
      return
    }
    switch (frame.event) {
      case "session.created":
        onSessionCreated(frame)
        break
      case "session.updated":
      case "session.started":
      case "session.stopped":
        onSessionUpdated(frame, false)
        break
      case "session.crashed":
        onSessionUpdated(frame, true)
        break
      case "session.deleted":
        onSessionDeleted(frame)
        break
      case "autorun.created":
      case "autorun.updated":
        onAutorunUpsert(frame)
        break
      case "autorun.deleted":
        onAutorunDeleted(frame)
        break
      case "recording.created": {
        client.invalidateQueries({ queryKey: queryRoots.recordings })
        const id = frameEntityId(frame)
        options.toast?.({
          kind: "success",
          message: "Recording saved",
          action: {
            label: "Open",
            to: id === undefined ? "/recordings" : `/recordings?highlight=${String(id)}`,
          },
        })
        break
      }
      case "recording.updated":
        onRecordingUpdated(frame)
        break
      case "recording.deleted":
        onRecordingDeleted(frame)
        break
      case "profile.created":
      case "profile.updated":
      case "profile.deleted": {
        client.invalidateQueries({ queryKey: queryRoots.profiles })
        const profileId = frameEntityId(frame)
        if (profileId !== undefined) {
          client.invalidateQueries({ queryKey: queryKeys.profile(profileId) })
        }
        break
      }
      default:
        onUnknownSubject(frame)
    }
  }

  return { handleFrame, dispose }
}

let activeUnregister: (() => void) | null = null
let activeTable: EventTable | null = null

/** Wire the table into the realtime manager's /ws/events handler slot. */
export function installEventTable(options: EventTableOptions = {}): () => void {
  disposeEventTable()
  const table = createEventTable(defaultQueryClient, options)
  activeUnregister = setRealtimeFrameHandlers({
    onEvent: (frame) => table.handleFrame(frame),
    onNotification: () => {
      void defaultQueryClient.invalidateQueries({
        queryKey: queryKeys.notifications,
      })
    },
  })
  activeTable = table
  return disposeEventTable
}

export function disposeEventTable(): void {
  activeUnregister?.()
  activeUnregister = null
  activeTable?.dispose()
  activeTable = null
}
