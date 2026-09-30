/**
 * The mandated focus treatment (docs/web-frontend-spec.md L473): a visible
 * 2px `--accent` ring, offset 1px, on every interactive element — never
 * `outline: none` without the ring replacement. One definition, imported by
 * every primitive so the ring cannot drift between them.
 */
export const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
