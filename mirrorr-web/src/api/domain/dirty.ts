/**
 * Dirty-field diffing for D1/D2 submission semantics (functional contract:
 * per-field dirty tracking, all-or-nothing bodies for create; `PUT` sends
 * only dirty fields — exclude_unset semantics, locked fields never sent).
 */

export type FieldMap = Record<string, unknown>

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === undefined || b === undefined || a === null || b === null) return false
  if (typeof a !== "object" || typeof b !== "object") return false
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Keys whose current value differs from the initial snapshot (deep-equal on
 * plain objects/arrays via JSON compare). Absent-in-current counts as dirty
 * only when the initial had a value.
 */
export function diffDirtyFields(initial: FieldMap, current: FieldMap): string[] {
  const keys = new Set([...Object.keys(initial), ...Object.keys(current)])
  const dirty: string[] = []
  for (const key of keys) {
    if (!sameValue(initial[key], current[key])) dirty.push(key)
  }
  return dirty
}

/**
 * True when any listed key that exists in `current` differs from `initial`.
 * Keys absent from `current` are ignored (call snapshots always enumerate
 * their fields); use `diffDirtyFields` when present/absent must count.
 */
export function isDirty(initial: FieldMap, current: FieldMap, keys: readonly string[]): boolean {
  return keys.some((key) => key in current && !sameValue(initial[key], current[key]))
}
