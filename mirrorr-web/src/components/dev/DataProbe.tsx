/**
 * TEMPORARY scaffolding for the data-layer step. Renders one list through the
 * real hooks (cursor pagination, loaded-row filters, name memo map) so the
 * data-layer acceptance specs can run before the real views exist.
 *
 * REMOVE IN WAVE 2: the real session/recording/profile lists replace this
 * probe (the plan lists it as scaffolding only). Every value comes from a
 * token declared in src/styles.css — no literal colour lives here.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { z } from "zod"
import { useAutoLoadOnIntersect } from "@/hooks/use-auto-load"
import { useInfiniteList, type InfinitePageRequest } from "@/hooks/use-infinite-list"
import { useNameMap } from "@/hooks/use-name-map"
import { apiFetch } from "@/lib/api"
import { userMessageForError } from "@/lib/errors"
import type { NameMapKind } from "@/lib/name-map"
import { QUERY_STALE_TIMES_MS, queryKeys } from "@/lib/query-keys"
import { cursorPageSchema, type CursorPage } from "@/lib/schemas/pagination"

/** Only the fields this probe renders; the server sends more (passthrough). */
const probeSessionSchema = z
  .object({
    id: z.number().int(),
    status: z.string(),
    engine_id: z.number().int().nullable().optional(),
    resolver_id: z.number().int().nullable().optional(),
    profile_id: z.number().int().nullable().optional(),
  })
  .passthrough()

type ProbeSession = z.infer<typeof probeSessionSchema>

const STATUS_FILTER_ALL = "all"

const SESSION_STATUSES = [
  "active",
  "recording",
  "terminating",
  "remuxing",
  "finalizing",
  "completed",
  "failed",
] as const

/** The probe's endpoint: `GET /sessions/?cursor=<id>&limit=<n>` (L138). */
function fetchSessionsPage(request: InfinitePageRequest): Promise<CursorPage<ProbeSession>> {
  const params = new URLSearchParams({ limit: String(request.limit) })
  if (request.cursor !== null) params.set("cursor", String(request.cursor))
  return apiFetch<CursorPage<ProbeSession>>(`/sessions/?${params.toString()}`, {
    schema: cursorPageSchema(probeSessionSchema),
    signal: request.signal,
  })
}

/**
 * Filters run against LOADED rows only (L134) — the server is never sent the
 * filter, which is why the key reset below is the only server-visible effect
 * of a filter change.
 */
function matchesLoadedRow(
  session: ProbeSession,
  search: string,
  statusFilter: string,
  nameFor: (kind: NameMapKind, id: number | null | undefined) => string | undefined,
): boolean {
  if (statusFilter !== STATUS_FILTER_ALL && session.status !== statusFilter) return false
  if (search.length === 0) return true

  const haystack = [
    String(session.id),
    session.status,
    nameFor("engine", session.engine_id) ?? "",
    nameFor("resolver", session.resolver_id) ?? "",
    nameFor("profile", session.profile_id) ?? "",
  ]
    .join(" ")
    .toLowerCase()

  return haystack.includes(search.toLowerCase())
}

export function DataProbe() {
  const [searchText, setSearchText] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>(STATUS_FILTER_ALL)

  // The filter object goes into the query key (a change resets pagination to a
  // fresh cursor — L138) but NOT into the request.
  const filters = useMemo(
    () => ({
      search: searchText.trim(),
      status: statusFilter === STATUS_FILTER_ALL ? "" : statusFilter,
    }),
    [searchText, statusFilter],
  )

  const { nameFor } = useNameMap()

  const {
    rows,
    hasMore,
    isInitialLoading,
    isLoadingMore,
    isLoadingAll,
    isError,
    error,
    loadMore,
    loadAll,
  } = useInfiniteList<ProbeSession>({
    queryKey: queryKeys.sessions(filters),
    fetchPage: fetchSessionsPage,
    staleTime: QUERY_STALE_TIMES_MS.sessions,
  })

  const sentinelRef = useRef<HTMLDivElement | null>(null)

  // A non-"all" status filter auto-exhausts pagination BEFORE presenting
  // results (L134): every page is fetched, then the filter is applied.
  const autoExhaustedFor = useRef<string | null>(null)
  useEffect(() => {
    if (statusFilter === STATUS_FILTER_ALL) {
      autoExhaustedFor.current = null
      return
    }
    if (!hasMore || autoExhaustedFor.current === statusFilter) return
    autoExhaustedFor.current = statusFilter
    loadAll()
  }, [statusFilter, hasMore, loadAll])

  const filterActive = filters.search.length > 0 || statusFilter !== STATUS_FILTER_ALL
  const exhaustBeforeResults = statusFilter !== STATUS_FILTER_ALL && hasMore

  const visibleRows = useMemo(
    () => rows.filter((session) => matchesLoadedRow(session, filters.search, statusFilter, nameFor)),
    [rows, filters.search, statusFilter, nameFor],
  )

  // While a filter is active, the disclosure + "Load all" is the specified
  // interaction (L134), so the observer stays off and the list is never
  // silently exhausted behind the user's back.
  useAutoLoadOnIntersect(sentinelRef, {
    enabled: hasMore && !filterActive && !exhaustBeforeResults && !isLoadingAll,
    onLoad: loadMore,
  })

  const showingCount =
    isInitialLoading || exhaustBeforeResults ? "Showing …" : `Showing ${visibleRows.length}${hasMore ? "+" : ""}`

  return (
    <section
      data-testid="data-probe"
      aria-label="Data layer probe"
      className="flex w-full max-w-3xl flex-col gap-4"
    >
      <header className="flex flex-col gap-1">
        <h1 className="text-title font-semibold text-text-primary">Data layer probe</h1>
        <p className="text-small text-text-secondary">
          Temporary scaffold: cursor pagination, loaded-row filters and the name memo map.
        </p>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1 text-label text-text-secondary">
          Search loaded rows
          <input
            data-testid="probe-search"
            type="search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search loaded rows"
            className="h-8 rounded-control border border-border bg-bg-inset px-2 text-small text-text-primary"
          />
        </label>
        <label className="flex flex-col gap-1 text-label text-text-secondary">
          Status (non-all loads every page)
          <select
            data-testid="probe-status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="h-8 rounded-control border border-border bg-bg-inset px-2 text-small text-text-primary"
          >
            <option value={STATUS_FILTER_ALL}>All statuses</option>
            {SESSION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
      </div>

      {hasMore && filterActive ? (
        <div
          data-testid="filter-disclosure"
          className="flex items-center justify-between gap-3 rounded-surface border border-border bg-bg-overlay px-3 py-2"
        >
          <p data-testid="filter-hint" className="text-small text-text-secondary">
            Filter applies to loaded rows
          </p>
          <button
            type="button"
            data-testid="load-all"
            onClick={loadAll}
            disabled={isLoadingAll}
            className="inline-flex h-8 items-center justify-center rounded-control border border-border bg-bg-raised px-3 text-small text-text-primary transition-colors duration-[var(--motion-fast)] ease-out disabled:opacity-50"
          >
            Load all
          </button>
        </div>
      ) : null}

      <div
        data-testid="data-probe-scroll"
        className="max-h-28 overflow-y-auto rounded-surface border border-border bg-bg-raised"
      >
        {isInitialLoading ? (
          <p data-testid="probe-loading" className="p-3 text-small text-text-muted">
            Loading…
          </p>
        ) : null}
        {exhaustBeforeResults ? (
          <p data-testid="auto-exhausting" className="p-3 text-small text-text-muted">
            Loading every page before applying the status filter…
          </p>
        ) : null}
        {isError ? (
          <p data-testid="probe-error" className="p-3 text-small text-danger">
            {userMessageForError(error)}
          </p>
        ) : null}
        {!isInitialLoading && !exhaustBeforeResults && !isError ? (
          visibleRows.length === 0 ? (
            <p data-testid="probe-empty" className="p-3 text-small text-text-muted">
              No loaded rows match the filter
            </p>
          ) : (
            <ul>
              {visibleRows.map((session) => (
                <ProbeRow key={session.id} session={session} nameFor={nameFor} />
              ))}
            </ul>
          )
        ) : null}
        <div ref={sentinelRef} data-testid="load-more-sentinel" aria-hidden="true" className="h-px w-full" />
      </div>

      <footer className="flex items-center justify-between gap-3">
        <span data-testid="showing-count" className="text-small text-text-secondary">
          {showingCount}
        </span>
        <button
          type="button"
          data-testid="load-more"
          onClick={loadMore}
          disabled={!hasMore || isLoadingMore}
          className="inline-flex h-8 items-center justify-center rounded-control border border-border bg-bg-overlay px-3 text-small text-text-primary transition-colors duration-[var(--motion-fast)] ease-out disabled:opacity-50"
        >
          Load more
        </button>
      </footer>
    </section>
  )
}

interface ProbeRowProps {
  readonly session: ProbeSession
  readonly nameFor: (kind: NameMapKind, id: number | null | undefined) => string | undefined
}

function ProbeRow({ session, nameFor }: ProbeRowProps) {
  return (
    <li data-testid="probe-row" data-id={session.id} className="flex h-9 items-center gap-3 px-3">
      <span className="w-12 shrink-0 font-mono text-small text-text-secondary">#{session.id}</span>
      <span data-testid="probe-session-status" className="w-24 shrink-0 text-small text-text-primary">
        {session.status}
      </span>
      <NameCell testId="engine-name" kind="engine" id={session.engine_id ?? null} nameFor={nameFor} />
      <NameCell testId="resolver-name" kind="resolver" id={session.resolver_id ?? null} nameFor={nameFor} />
      <NameCell testId="profile-name" kind="profile" id={session.profile_id ?? null} nameFor={nameFor} />
    </li>
  )
}

interface NameCellProps {
  readonly testId: string
  readonly kind: NameMapKind
  readonly id: number | null
  readonly nameFor: (kind: NameMapKind, id: number | null | undefined) => string | undefined
}

/** A resolved name is secondary text; an unresolved id renders muted `#<id>`. */
function NameCell({ testId, kind, id, nameFor }: NameCellProps) {
  if (id === null) {
    return (
      <span data-testid={testId} className="text-small text-text-muted">
        —
      </span>
    )
  }

  const name = nameFor(kind, id)
  if (name === undefined) {
    return (
      <span data-testid={testId} className="text-small text-text-muted">
        #{id}
      </span>
    )
  }

  return (
    <span data-testid={testId} className="text-small text-text-secondary">
      {name}
    </span>
  )
}
