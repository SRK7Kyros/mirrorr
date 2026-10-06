import { EmptyState } from "@/ui/components"
import { Page } from "./page"

/**
 * Temporary body for surfaces whose implementation lands in a later wave.
 * Replaced one-for-one by the real view — never shipped to production.
 */
export function PlaceholderView({ title }: { readonly title: string }) {
  return (
    <Page title={title}>
      <EmptyState title={`${title} — coming next`} text="This surface is being rebuilt in the Control Room pass." />
    </Page>
  )
}
