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
  SchemaForm,
  SkeletonRows,
  asObject,
  defaultsFromSchema,
} from "@/ui/components"

/** Debounce window for the search box of a search-only resolver (design spec §6.3). */
const SEARCH_DEBOUNCE_MS = 250

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
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [filters, setFilters] = useState<Record<string, unknown>>({})
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  const catalog = resolver?.has_catalog === true
  const serverQuery = catalog ? "" : debouncedQuery
  const typed = query.trim()

  // A fresh run each time the overlay opens or the resolver changes.
  useEffect(() => {
    if (!open) return
    setQuery("")
    setDebouncedQuery("")
    setFilters(defaultsFromSchema(resolver?.search_schema))
  }, [open, resolver])

  useEffect(() => {
    if (catalog) return
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [catalog, query])

  const page = useInfiniteQuery({
    queryKey: ["discovery", resolver?.id ?? 0, catalog ? "catalog" : "search", serverQuery, filters],
    enabled: open && resolver !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      if (resolver === null) throw new Error("No resolver selected")
      return discoverResolver(resolver.id, {
        ...(serverQuery === "" ? {} : { query: serverQuery }),
        params: filters,
        cursor: pageParam ?? null,
      })
    },
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })

  const loaded = useMemo(() => page.data?.pages.flatMap((entry) => entry.items ?? []) ?? [], [page.data])
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = page

  const items = useMemo(
    () => (catalog ? rankBySearch(loaded, query, (item) => [item.title]) : loaded),
    [catalog, loaded, query],
  )

  // A catalog is read to its end, not to the fold: the filtering happens here,
  // so a match on page twenty cannot wait for a scroll that may never come.
  useEffect(() => {
    if (!open || !catalog || !hasNextPage || isFetchingNextPage) return
    void fetchNextPage()
  }, [open, catalog, hasNextPage, isFetchingNextPage, fetchNextPage, loaded.length])

  // Infinite scroll: the sentinel is only observed while another page exists
  // and the pages are not already being pulled in the background.
  useEffect(() => {
    const node = sentinelRef.current
    if (node === null || catalog || !hasNextPage || isFetchingNextPage) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void fetchNextPage()
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [catalog, hasNextPage, isFetchingNextPage, fetchNextPage, items.length])

  const hasFilters = Object.keys(asObject(resolver?.search_schema)).length > 0
  const readingCatalog = catalog && hasNextPage

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

        {hasFilters ? (
          <SchemaForm
            schema={resolver?.search_schema}
            value={filters}
            onChange={setFilters}
            idPrefix="discovery-filters"
          />
        ) : null}

        {page.isLoading ? (
          <SkeletonRows rows={4} cols={2} />
        ) : page.isError ? (
          <ErrorPanel
            message={getErrorMessage(page.error, "Could not load the catalog")}
            onRetry={() => void page.refetch()}
          />
        ) : items.length === 0 ? (
          readingCatalog && typed !== "" ? (
            <p className="text-ink-dim" style={{ fontSize: "var(--fs-sm)" }}>
              Nothing read so far matches “{typed}” — still loading the catalog…
            </p>
          ) : readingCatalog ? (
            <SkeletonRows rows={4} cols={2} />
          ) : (
            <EmptyState
              title="No results"
              text={typed === "" ? "This catalog returned nothing." : `Nothing matches “${typed}”.`}
            />
          )
        ) : (
          <>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3 m-0 p-0 list-none">
              {items.map((item) => (
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
