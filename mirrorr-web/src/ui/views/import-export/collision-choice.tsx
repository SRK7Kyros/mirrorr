import { FilterSegmented } from "@/ui/components"
import type { Collision, CollisionMode } from "./import-logic"

const OPTIONS = [
  { id: "replace", label: "Replace" },
  { id: "skip", label: "Skip" },
  { id: "keep", label: "Keep both" },
] as const

/** One line per mode: what apply actually does, in the item's own names. */
function hint(mode: CollisionMode, name: string, keepName: string): string {
  switch (mode) {
    case "replace":
      return `Deletes “${name}” first, then imports this one under its name. Undo cannot restore the deleted item.`
    case "skip":
      return `Leaves “${name}” untouched.`
    case "keep":
      return `Imports alongside it as “${keepName}”.`
  }
}

/**
 * The three ways out of a name collision, as one pressed-button group rather
 * than three radios: the choice is a mode the row stays in, and the hint under
 * it states the consequence so "Replace" is never mistaken for a merge.
 */
export function CollisionChoice({
  bundledName,
  collision,
  mode,
  onChange,
}: {
  readonly bundledName: string
  readonly collision: Collision
  readonly mode: CollisionMode
  readonly onChange: (mode: CollisionMode) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <FilterSegmented
        items={OPTIONS}
        value={mode}
        onChange={onChange}
        ariaLabel={`Name conflict for ${bundledName}`}
      />
      <p className="text-sm text-ink-dim">{hint(mode, bundledName, collision.keepName)}</p>
    </div>
  )
}
