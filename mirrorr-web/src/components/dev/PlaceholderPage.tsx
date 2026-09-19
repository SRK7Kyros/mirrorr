interface PlaceholderPageProps {
  readonly title: string
  readonly testId: string
}

/** Temporary target for routes whose real view lands in a later wave. */
export function PlaceholderPage({ title, testId }: PlaceholderPageProps) {
  return (
    <main data-testid={testId} className="grid min-h-dvh place-items-center bg-bg-base p-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-heading font-semibold tracking-tight text-text-primary">{title}</h1>
        <p className="text-body text-text-secondary">This view arrives in a later step.</p>
      </div>
    </main>
  )
}
