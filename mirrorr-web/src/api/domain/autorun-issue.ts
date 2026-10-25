import type { Autorun } from "@/api/schemas"

/**
 * What a flagged schedule says about itself. `label` is the short pill beside
 * the status chip; `title`/`detail` are the banner copy. The server only ever
 * blocks a row for a reason it can explain, and an unrecognised code still
 * gets a banner rather than a row that looks healthy.
 */
export interface AutorunIssue {
  readonly code: string
  readonly label: string
  readonly title: string
  readonly detail: string
}

const NEEDS_ATTENTION = "Needs attention"

const KNOWN: Readonly<Record<string, Omit<AutorunIssue, "code">>> = {
  "profile-deleted": {
    label: NEEDS_ATTENTION,
    title: "Its profile was deleted, so it will not run",
    detail:
      "The engine, resolver and config it copied when it was created are still here, but nothing starts it until you pick a profile again. Edit it, choose one and save — saving clears this warning.",
  },
}

/** The banner copy for a flagged autorun, or `null` for a healthy one. */
export function autorunIssue(autorun: Pick<Autorun, "issue">): AutorunIssue | null {
  const code = autorun.issue ?? ""
  if (code === "") return null
  const known = KNOWN[code]
  if (known !== undefined) return { code, ...known }
  return {
    code,
    label: NEEDS_ATTENTION,
    title: `It cannot run: ${code}`,
    detail: "This console does not know that reason. Open it and save it to clear the flag, or ask an admin.",
  }
}

/** How many of these schedules are blocked — for a page header or a toast. */
export function flaggedCount(autoruns: readonly Pick<Autorun, "issue">[]): number {
  return autoruns.filter((autorun) => (autorun.issue ?? "") !== "").length
}

/** The sentence a profile deletion reports when it flagged schedules. */
export function flaggedNotice(count: number): string {
  if (count <= 0) return ""
  return count === 1
    ? "1 scheduled recording needs a new profile — it will not run until you pick one."
    : `${count} scheduled recordings need a new profile — they will not run until you pick one.`
}
