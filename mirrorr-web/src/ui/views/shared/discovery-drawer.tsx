import { useEffect, useMemo, useRef, useState } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { discoverResolver, getErrorMessage } from "@/api"
import { rankBySearch } from "@/api/domain/search"
import type { DiscoveryItem, Resolver } from "@/api/schemas"
import {
  Button,
  Drawer,
  EmptyState,
  ErrorPanel,
  IconSearch,
  Input,
  SkeletonRows,
  asObject,
} from "@/ui/components"

/** Debounce window for the search box, catalog or server-side alike (design spec §6.3). */
const SEARCH_DEBOUNCE_MS = 250

/** How many cards a filtered catalog reveals at a time, so one letter cannot lay out thousands. */
const VISIBLE_STEP = 60

const titleFields = (item: DiscoveryItem) => [item.title]

/**
 * Whether a resolver is worth opening this panel for: it either declares a
 * browsable catalog, or declares a discovery model (which is how a search-only
 * plugin announces it can be searched at all). A resolver with neither has no
 * discovery surface to show.
 */
export function canBrowseResolver(resolver: Resolver | null | undefined): resolver is Resolver {
  if (resolver === null || resolver === undefined) return false
  return resolver.has_catalog === true || Object.keys(asObject(resolver.search_schema)).length > 0
}

/**
 * Discovery overlay — browse or search a resolver's catalog and hand the chosen
 * item's config back.
 *
 * A resolver that declares a catalog (`has_catalog`, i.e. the plugin's
 * `discovery_has_catalog`) is read **once**: every page is pulled in the
 * background and the search box ranks what is already here with the same
 * typo-tolerant ranking the lists use (`rankBySearch` — the resolver plugin
 * ranks identically on its own search path), so typing costs no request at all.
 * Asking the server per keystroke made the plugin refetch its upstream catalog
 * each time and its rate limiter noticed. A search-only resolver has nothing to
 * filter, so there the text does go to the server, debounced.
 *
 * The resolver's discovery filter model is deliberately not rendered: the text
 * box is the only searchbox over a catalog, and a free-text filter over event
 * categories (all any plugin ever declared) narrowed nothing a user could see.
 * Server-side filters keep the defaults the plugin declares.
 *
 * `raised` because it opens from on top of the dialog that asked for a config.
 */
export function DiscoveryDrawer({
  open,
  onClose,
  resolver,
  onUse,
}: {
  readonly open: boolean
  readonly onClose: () => void
  readonly resolver: Resolver | null
  readonly onUse: (item: DiscoveryItem) => void
}) {
  const [query, setQuery] = useState("")
  // What the list and its readout are drawn for: typing only moves the field, so
  // the panel is never showing a count for a filter its cards do not answer.
  const [appliedQuery, setAppliedQuery] = useState("")
  const [shown, setShown] = useState(VISIBLE_STEP)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  const catalog = resolver?.has_catalog === true
  const serverQuery = catalog ? "" : appliedQuery

  // A fresh run each time the overlay opens or the resolver changes.
  useEffect(() => {
    if (!open) return
    setQuery("")
    setAppliedQuery("")
  }, [open, resolver])

  useEffect(() => {
    const timer = setTimeout(() => setAppliedQuery(query.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  const page = useInfiniteQuery({
    queryKey: ["discovery", resolver?.id ?? 0, catalog ? "catalog" : "search", serverQuery],
    enabled: open && resolver !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      if (resolver === null) throw new Error("No resolver selected")
      return discoverResolver(resolver.id, {
        ...(serverQuery === "" ? {} : { query: serverQuery }),
        cursor: pageParam ?? null,
      })
    },
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })

  const loaded = useMemo(() => page.data?.pages.flatMap((entry) => entry.items ?? []) ?? [], [page.data])
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = page

  const items = useMemo(
    () => (catalog ? rankBySearch(loaded, appliedQuery, titleFields) : loaded),
    [catalog, loaded, appliedQuery],
  )

  // The first screenfuls of a match arrive at once; the rest follows the scroll,
  // and a different filter starts over.
  useEffect(() => {
    setShown(VISIBLE_STEP)
  }, [catalog, appliedQuery, resolver, open])

  const visible = items.slice(0, shown)

  // A catalog is read to its end, not to the fold: the filtering happens here,
  // so a match on page twenty cannot wait for a scroll that may never come.
  useEffect(() => {
    if (!open || !catalog || !hasNextPage || isFetchingNextPage) return
    void fetchNextPage()
  }, [open, catalog, hasNextPage, isFetchingNextPage, fetchNextPage, loaded.length])

  // Infinite scroll: the sentinel reveals the next screenful of cards, and asks
  // for the next page once the last card of the held list is on screen.
  useEffect(() => {
    const node = sentinelRef.current
    if (node === null) return
    const moreCards = visible.length < items.length
    const morePages = hasNextPage && !isFetchingNextPage
    if (!moreCards && !morePages) return
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      if (visible.length < items.length) setShown((count) => count + VISIBLE_STEP)
      else void fetchNextPage()
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, items.length, visible.length])

  const readingCatalog = catalog && hasNextPage
  const matches =
    catalog && appliedQuery !== "" && (items.length > 0 || readingCatalog)
      ? `${items.length} of ${loaded.length} ${items.length === 1 ? "matches" : "match"} “${appliedQuery}”${
          readingCatalog ? " — still loading the catalog…" : ""
        }`
      : null

  return (
    <Drawer
      open={open}
      onClose={onClose}
      raised
      className="w-[min(1100px,92vw)]"
      title={resolver !== null ? `Browse ${resolver.name}` : "Browse"}
    >
      <div className="flex flex-col gap-4">
        <div className="relative flex-1 min-w-[200px] max-w-[340px] [&_input]:pl-8">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" aria-hidden="true">
            <IconSearch size={15} />
          </span>
          <Input
            value={query}
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            placeholder={catalog ? "Filter…" : "Search…"}
            aria-label="Search the catalog"
          />
        </div>

        {matches !== null ? (
          <p className="text-ink-dim" style={{ fontSize: "var(--fs-sm)" }}>
            {matches}
          </p>
        ) : null}

        {page.isLoading ? (
          <SkeletonRows rows={4} cols={2} />
        ) : page.isError ? (
          <ErrorPanel
            message={getErrorMessage(page.error, "Could not load the catalog")}
            onRetry={() => void page.refetch()}
          />
        ) : items.length === 0 ? (
          readingCatalog ? (
            <SkeletonRows rows={4} cols={2} />
          ) : (
            <EmptyState
              title="No results"
              text={appliedQuery === "" ? "This catalog returned nothing." : `Nothing matches “${appliedQuery}”.`}
            />
          )
        ) : (
          <>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3 m-0 p-0 list-none">
              {visible.map((item) => (
                <li key={item.id} className="flex flex-col gap-3 p-3 border border-line rounded-md bg-surface-2">
                  {item.image !== null && item.image !== undefined && item.image !== "" ? (
                    <img className="w-full aspect-video object-cover rounded-sm bg-sunken" src={item.image} alt="" loading="lazy" />
                  ) : null}
                  <div className="flex flex-1 flex-col gap-1 min-w-0">
                    <span className="text-base font-semibold text-ink [overflow-wrap:anywhere]">{item.title}</span>
                    {item.subtitle !== null && item.subtitle !== undefined && item.subtitle !== "" ? (
                      <span className="text-sm text-ink-muted">{item.subtitle}</span>
                    ) : null}
                    {item.description !== null && item.description !== undefined && item.description !== "" ? (
                      <p className="text-sm text-ink-dim [overflow-wrap:anywhere]">{item.description}</p>
                    ) : null}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => onUse(item)}>
                    Use
                  </Button>
                </li>
              ))}
            </ul>
            {isFetchingNextPage ? <SkeletonRows rows={2} cols={2} /> : null}
            <div ref={sentinelRef} aria-hidden="true" />
          </>
        )}
      </div>
    </Drawer>
  )
}
