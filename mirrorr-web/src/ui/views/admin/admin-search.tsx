import { IconSearch, Input } from "@/ui/components"

/**
 * The toolbar's search field. It is its own component so all five admin panels
 * put the icon in the same place and give the field the same accessible name;
 * the list itself filters through `rankBySearch`, never a second server call.
 */
export function AdminSearch({
  value,
  onChange,
  label,
  placeholder,
}: {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly label: string
  readonly placeholder: string
}) {
  return (
    <div className="relative [&_input]:pl-8">
      <span
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint"
        aria-hidden="true"
      >
        <IconSearch size={15} />
      </span>
      <Input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}
