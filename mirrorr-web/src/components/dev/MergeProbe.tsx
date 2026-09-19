/**
 * TEMPORARY merge probe (removed together with DataProbe in Wave 2). It drives
 * the real `EntityStore` against the real TanStack Query cache and renders the
 * result, so the acceptance browser spec can *see* the merge precedence:
 *
 * - a create response and its WS echo collapse to exactly one row, in either
 *   arrival order, with the echo's fields winning;
 * - a 409 recording toggle flips optimistically and reverts the previous value.
 *
 * The list is seeded locally (no endpoint is involved): the point here is the
 * cache mechanics, not the transport. Every colour/typography value comes from
 * a token declared in src/styles.css — no literal colour lives here.
 */
import type { InfiniteData } from "@tanstack/react-query"
import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useMemo, useSyncExternalStore } from "react"
import { useInfiniteList, type InfinitePageRequest } from "@/hooks/use-infinite-list"
import { ApiError } from "@/lib/errors"
import type { EntityValues } from "@/lib/entity-merge"
import { EntityStore } from "@/lib/entity-store"
import { toggleRecording } from "@/lib/optimistic-policy"
import { queryKeys } from "@/lib/query-keys"
import type { CursorPage } from "@/lib/schemas/pagination"

const TOGGLE_ID = 7
const HTTP_FIRST_ID = 42
const WS_FIRST_ID = 43
/** Long enough for the spec to observe the optimistic flip before the 409. */
const TOGGLE_FAILURE_DELAY_MS = 800

/** Only the fields this probe renders; the store keeps whole entities. */
interface ProbeSession extends EntityValues {
  readonly status: string
  readonly record: boolean
}

const LIST_KEY = queryKeys.sessions({ probe: "merge" })

const SEED_PAGE: CursorPage<ProbeSession> = {
  items: [{ id: TOGGLE_ID, status: "recording", record: true }],
  next_cursor: null,
  has_more: false,
}

const BUTTON_CLASSES =
  "inline-flex h-8 items-center justify-center rounded-control border border-border bg-bg-overlay px-3 text-small text-text-primary transition-colors duration-[var(--motion-fast)] ease-out"

export function MergeProbe() {
  const queryClient = useQueryClient()
  const store = useMemo(() => new EntityStore({ queryClient }), [queryClient])
  const fetchPage = useCallback(async (_request: InfinitePageRequest) => SEED_PAGE, [])

  const { rows } = useInfiniteList<ProbeSession>({
    queryKey: LIST_KEY,
    fetchPage,
    staleTime: Number.POSITIVE_INFINITY,
  })

  const subscribePending = useCallback(
    (listener: () => void) => store.subscribePending(listener),
    [store],
  )
  const readPendingFields = useCallback(
    () => store.getPendingFields("session", TOGGLE_ID),
    [store],
  )
  const pendingFields = useSyncExternalStore(subscribePending, readPendingFields)

  const toggleRow = rows.find((row) => row.id === TOGGLE_ID)
  const overlayRecord = pendingFields?.record
  const recordValue = typeof overlayRecord === "boolean" ? overlayRecord : (toggleRow?.record ?? false)

  const cacheData = queryClient.getQueryData<InfiniteData<CursorPage<ProbeSession>, null>>(LIST_KEY)
  const rawCount = (id: number): number =>
    cacheData?.pages.flatMap((page) => page.items).filter((row) => row.id === id).length ?? 0

  /** Arrival order 1: the HTTP create response lands before the WS echo. */
  const createHttpFirst = () => {
    store.applyMutationResponse("session", { id: HTTP_FIRST_ID, status: "active", record: false })
    void store.applyFrame({
      event: "session.created",
      id: HTTP_FIRST_ID,
      data: { id: HTTP_FIRST_ID, status: "recording", record: false },
    })
  }

  /** Arrival order 2: the WS echo lands before the HTTP create response. */
  const createWsFirst = () => {
    void store.applyFrame({
      event: "session.created",
      id: WS_FIRST_ID,
      data: { id: WS_FIRST_ID, status: "recording", record: false },
    })
    store.applyMutationResponse("session", { id: WS_FIRST_ID, status: "active", record: false })
  }

  /** The server rejects the flip with 409 after the overlay already moved. */
  const toggleWith409 = async () => {
    try {
      await toggleRecording(store, {
        resource: "session",
        id: TOGGLE_ID,
        optimisticFields: { record: !recordValue },
        mutate: async () => {
          await new Promise((resolve) => setTimeout(resolve, TOGGLE_FAILURE_DELAY_MS))
          throw new ApiError({ status: 409, detail: "Toggle rejected by the server" })
        },
      })
    } catch {
      // The probe renders whatever the store now says; the revert is the point.
    }
  }

  return (
    <section data-testid="merge-probe" className="mt-6 border-t border-border pt-4">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-text-primary">Entity merge probe</h2>
        <span className="text-small text-text-muted">temporary — removed in Wave 2</span>
      </header>
      <p className="mt-1 text-small text-text-secondary">
        Real EntityStore, real TanStack cache, locally seeded list. No endpoint is called.
      </p>

      <ul data-testid="merge-rows" className="mt-3">
        {rows.map((row) => (
          <li
            key={row.id}
            data-testid="merge-row"
            data-id={row.id}
            className="flex h-9 items-center gap-3 px-3"
          >
            <span className="w-12 shrink-0 font-mono text-small text-text-secondary">#{row.id}</span>
            <span data-testid="merge-status" className="w-24 shrink-0 text-small text-text-primary">
              {row.status}
            </span>
            {row.id === TOGGLE_ID ? (
              <span data-testid="merge-toggle-value" className="text-small text-text-secondary">
                {recordValue ? "recording on" : "recording off"}
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      <dl className="mt-3 flex flex-wrap gap-6 text-small text-text-secondary">
        <div className="flex gap-2">
          <dt>raw rows #42</dt>
          <dd data-testid="merge-count-42" className="font-mono text-text-primary">
            {rawCount(HTTP_FIRST_ID)}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt>raw rows #43</dt>
          <dd data-testid="merge-count-43" className="font-mono text-text-primary">
            {rawCount(WS_FIRST_ID)}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt>pending</dt>
          <dd data-testid="merge-pending" className="font-mono text-text-primary">
            {pendingFields === undefined ? "none" : "pending"}
          </dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="merge-create-http-first"
          onClick={createHttpFirst}
          className={BUTTON_CLASSES}
        >
          HTTP response, then WS echo
        </button>
        <button
          type="button"
          data-testid="merge-create-ws-first"
          onClick={createWsFirst}
          className={BUTTON_CLASSES}
        >
          WS echo, then HTTP response
        </button>
        <button
          type="button"
          data-testid="merge-toggle-409"
          onClick={() => void toggleWith409()}
          className={BUTTON_CLASSES}
        >
          Toggle recording (409)
        </button>
      </div>
    </section>
  )
}
