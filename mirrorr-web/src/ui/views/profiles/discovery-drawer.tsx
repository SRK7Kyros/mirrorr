import { useEffect, useMemo, useRef, useState } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { discoverResolver, getErrorMessage } from "@/api"
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

/** Debounce window for the search box (design spec §6.3). */
const SEARCH_DEBOUNCE_MS = 250

/**
 * Discovery overlay — browse or search a resolver's catalog and hand the chosen
 * item's config back. Mode is inferred: a query searches, no query browses.
 * `raised` because it opens from on top of the source dialog.
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

  // A fresh run each time the overlay opens or the resolver changes.
  useEffect(() => {
    if (!open) return
    setQuery("")
    setDebouncedQuery("")
    setFilters(defaultsFromSchema(resolver?.search_schema))
  }, [open, resolver])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  const page = useInfiniteQuery({
    queryKey: ["discovery", resolver?.id ?? 0, debouncedQuery, filters],
    enabled: open && resolver !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      if (resolver === null) throw new Error("No resolver selected")
      return discoverResolver(resolver.id, {
        ...(debouncedQuery === "" ? {} : { query: debouncedQuery }),
        params: filters,
        cursor: pageParam ?? null,
      })
    },
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })

  const items = useMemo(() => page.data?.pages.flatMap((entry) => entry.items ?? []) ?? [], [page.data])
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = page

  // Infinite scroll: the sentinel is only observed while another page exists.
  useEffect(() => {
    const node = sentinelRef.current
    if (node === null || !hasNextPage || isFetchingNextPage) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void fetchNextPage()
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, items.length])

  const hasFilters = Object.keys(asObject(resolver?.search_schema)).length > 0

  return (
    <Drawer
      open={open}
      onClose={onClose}
      raised
      className="drawer-wide"
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
            placeholder="Search…"
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
          <EmptyState
            title="No results"
            text={debouncedQuery === "" ? "This catalog returned nothing." : `Nothing matches “${debouncedQuery}”.`}
          />
        ) : (
          <>
            <ul className="discovery-grid">
              {items.map((item) => (
                <li key={item.id} className="discovery-card">
                  {item.image !== null && item.image !== undefined && item.image !== "" ? (
                    <img className="discovery-card-image" src={item.image} alt="" loading="lazy" />
                  ) : null}
                  <div className="discovery-card-text">
                    <span className="discovery-card-title">{item.title}</span>
                    {item.subtitle !== null && item.subtitle !== undefined && item.subtitle !== "" ? (
                      <span className="discovery-card-subtitle">{item.subtitle}</span>
                    ) : null}
                    {item.description !== null && item.description !== undefined && item.description !== "" ? (
                      <p className="discovery-card-desc">{item.description}</p>
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
