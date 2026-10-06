/** Minimal class-name joiner — filters falsy values and flattens one level. */
export type ClassValue = string | number | false | null | undefined

export function cn(...values: ClassValue[]): string {
  let out = ""
  for (const value of values) {
    if (value === false || value === null || value === undefined || value === "") continue
    out = out === "" ? String(value) : `${out} ${value}`
  }
  return out
}
