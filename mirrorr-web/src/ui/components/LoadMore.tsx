import { Button } from "./Button"
import { Spinner } from "./Spinner"

export interface LoadMoreProps {
  readonly hasMore: boolean
  readonly isFetching: boolean
  readonly onLoadMore: () => void
  readonly onLoadAll?: () => void
  readonly loadingAll?: boolean
  readonly count: number
}

/**
 * Cursor-list footer — "Load more" (one page) + optional "Load all". Renders
 * nothing once the list is exhausted (the honest-count rule: no fake totals).
 */
export function LoadMore({ hasMore, isFetching, onLoadMore, onLoadAll, loadingAll = false, count }: LoadMoreProps) {
  if (!hasMore) return null
  return (
    <div className="flex justify-center p-4">
      <div className="row">
        <Button variant="outline" onClick={onLoadMore} disabled={isFetching} icon={isFetching ? <Spinner /> : undefined}>
          Load more
        </Button>
        {onLoadAll !== undefined ? (
          <Button variant="ghost" onClick={onLoadAll} loading={loadingAll}>
            Load all
          </Button>
        ) : null}
        <span className="text-dim text-sm">{count} shown</span>
      </div>
    </div>
  )
}
