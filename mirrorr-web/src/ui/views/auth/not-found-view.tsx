import { Link } from "@tanstack/react-router"
import { buttonClass, IconSearch } from "@/ui/components"
import { Page } from "@/ui/views/shared/page"

/**
 * A 404 is still a page of the app: it keeps the shell, so the way out is the
 * navigation the user already knows rather than a bare exit link on a blank
 * screen. Two doors, both 44 px: back to the list they were probably after, and
 * the other media surface.
 */
export function NotFoundView() {
  return (
    <Page title="Page not found">
      <div className="mx-auto flex w-full max-w-[46ch] flex-col items-center gap-4 py-16 text-center">
        <span className="grid size-12 place-content-center rounded-md border border-line bg-surface-2 text-ink-dim">
          <IconSearch size={22} />
        </span>
        <h2 className="text-lg font-semibold text-ink">That address does not exist</h2>
        <p className="text-base text-ink-muted">
          The link may be stale, or the item was deleted. Nothing is broken — pick a list below.
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <Link className={`${buttonClass({ variant: "primary", size: "lg" })} min-h-11`} to="/sessions">
            Back to sessions
          </Link>
          <Link className={`${buttonClass({ variant: "secondary", size: "lg" })} min-h-11`} to="/recordings">
            Browse recordings
          </Link>
        </div>
      </div>
    </Page>
  )
}
