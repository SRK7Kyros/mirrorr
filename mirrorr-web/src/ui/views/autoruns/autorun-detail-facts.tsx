import type { ReactNode } from "react"

/**
 * One label/value pair inside a `dl`. The pair is a `div` so the `dl` stays
 * valid (HTML allows `div` to group `dt`/`dd`), and the value is the only place
 * a fact is printed — the schedule and the config disclosure both use it, and
 * neither repeats the other's rows.
 */
export function FactRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs font-medium tracking-[0.06em] text-dim uppercase">{label}</dt>
      <dd className="min-w-0 text-base text-ink [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}
