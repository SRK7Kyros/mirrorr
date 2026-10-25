import { pluralize } from "@/ui/lib/format"
import { Checkbox } from "./Checkbox"

export interface SelectionHeadProps {
  /** Accessible name of the box, e.g. "Select all recordings". */
  readonly label: string
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
  readonly count: number
  readonly noun: string
}

/** The select-all row a card list puts above itself — the count is the list's own. */
export function SelectionHead({ label, checked, onChange, count, noun }: SelectionHeadProps) {
  return (
    <div className="flex items-center gap-3 px-1">
      <Checkbox
        aria-label={label}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="text-dim" style={{ fontSize: "var(--fs-sm)" }}>
        {pluralize(count, noun)}
      </span>
    </div>
  )
}
