import { Link } from "@tanstack/react-router"
import { EmptyState, IconAlert } from "@/ui/components"
import { Page } from "@/ui/views/shared/page"

export function NotFoundView() {
  return (
    <Page title="Not found">
      <EmptyState
        icon={<IconAlert size={22} />}
        title="This page does not exist"
        text="The link may be stale, or the resource was removed."
        action={
          <Link className="btn btn-primary" to="/sessions">
            Back to sessions
          </Link>
        }
      />
    </Page>
  )
}
