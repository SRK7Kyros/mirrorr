/**
 * Neutral placeholder content — rendered inside AppShell's sole `<main>`
 * (authenticated) or standalone on public routes. Carries no design of its
 * own; real views land per design spec §5 in later waves.
 */
export function PlaceholderView() {
  return (
    <div className="placeholder">
      <h1 className="t-h1">Mirrorr</h1>
      <p className="t-body content-limiter">Sessions view is coming soon.</p>
    </div>
  )
}
