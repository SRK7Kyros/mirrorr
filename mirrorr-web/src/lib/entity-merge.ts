/**
 * The pure id-keyed entity merge rules — the precedence every WS frame and
 * every HTTP mutation response goes through.
 *
 * Contract:
 * - `docs/web-frontend-spec.md` L165-L181 (frame handling): `data` is
 *   authoritative when present; a data-less `updated/started/stopped/crashed`
 *   triggers a refetch instead; `deleted` always removes.
 * - `docs/web-frontend-spec.md` L183-L189 (cache-reaction table): `created`
 *   inserts into the list's first page; `updated` patches every cached copy.
 * - `docs/general-client-specification.md` §13.10.10: two clients share one
 *   server, so a WS event — not a local mutation — is the reconciliation
 *   trigger. A create response and its own WS echo are two views of ONE row.
 *
 * The rules encode this precedence, and only this precedence:
 *
 * 1. `deleted` wins over everything.
 * 2. An authoritative snapshot (WS frame with `data`) wins FIELD-BY-FIELD:
 *    every field the snapshot actually carries (`undefined` means "not sent")
 *    overwrites the cached value; fields it does not carry survive. Freshness
 *    is never derived from timestamps — `updated_at` is inert data.
 * 3. An HTTP mutation response INSERTS ONLY UNKNOWN IDS. It never overwrites a
 *    known entity, so a create response and its WS echo collapse to one row in
 *    either arrival order, and the echo's newer fields always win.
 */

/** Every entity cached by this client is identified by a numeric `id`. */
export interface EntityValues {
  readonly id: number
  readonly [field: string]: unknown
}

/** Rows of one cursor page (`CursorPage["items"]`). */
export type EntityPage<T extends EntityValues> = readonly T[]

/**
 * Per-field snapshot precedence (rule 2): the snapshot's defined fields win;
 * absent (`undefined`) fields are not "sent" and never erase cache state.
 * `null` IS sent — nullable columns clear explicitly.
 */
export function mergeEntitySnapshot<T extends EntityValues>(
  cached: T | undefined,
  snapshot: T,
): T {
  if (cached === undefined) return snapshot

  const merged: Record<string, unknown> = { ...cached }
  for (const field of Object.keys(snapshot)) {
    const value = snapshot[field]
    if (value === undefined) continue
    merged[field] = value
  }
  return merged as T
}

/**
 * HTTP mutation-response precedence (rule 3): insert an unknown id, never
 * overwrite a known one. `upsertEntityInPages` applies it per cache.
 */

export interface UpsertPagesOptions {
  /**
   * Unknown ids are inserted into the first page. `true` for `*.created`
   * frames and mutation responses; `false` for `*.updated` frames, which only
   * patch rows the user has already loaded.
   */
  readonly insert: boolean
  /**
   * Mutation-response mode: a known id is left byte-for-byte untouched (the
   * WS echo, or an earlier snapshot, is at least as fresh).
   */
  readonly insertOnly?: boolean
}

/**
 * Applies one entity to the cached cursor pages of one list family.
 *
 * - unknown id + `insert` → prepended to the FIRST page (spec L183);
 * - unknown id + no `insert` → no-op (an `updated` frame never injects a row);
 * - known id + `insertOnly` → no-op (mutation response cannot clobber);
 * - otherwise → every cached occurrence is merged field-by-field, so a row
 *   present on several loaded pages can never render stale twice.
 *
 * Never mutates the input pages.
 */
export function upsertEntityInPages<T extends EntityValues>(
  pages: readonly EntityPage<T>[],
  entity: T,
  options: UpsertPagesOptions,
): readonly EntityPage<T>[] {
  const known = pages.some((page) => page.some((row) => row.id === entity.id))

  if (!known) {
    if (!options.insert || pages.length === 0) return pages
    const [first, ...rest] = pages
    return [[entity, ...first], ...rest]
  }

  if (options.insertOnly === true) return pages

  return pages.map((page) =>
    page.some((row) => row.id === entity.id)
      ? page.map((row) => (row.id === entity.id ? mergeEntitySnapshot(row, entity) : row))
      : page,
  )
}

/** Removes every cached occurrence of `id` (`*.deleted` always wins). */
export function removeEntityFromPages<T extends EntityValues>(
  pages: readonly EntityPage<T>[],
  id: number,
): readonly EntityPage<T>[] {
  if (!pages.some((page) => page.some((row) => row.id === id))) return pages
  return pages.map((page) => page.filter((row) => row.id !== id))
}
