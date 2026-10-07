import { createContext, useContext, type ComponentType } from "react"

/**
 * Settings sections contributed by a build variant. The standard build
 * contributes none; the admin build contributes its own. This module names no
 * feature, so both builds carry exactly the same code — only the list differs.
 */
export interface SettingsSection {
  readonly id: string
  readonly Component: ComponentType
}

const NONE: readonly SettingsSection[] = []

export const SettingsSectionsContext = createContext<readonly SettingsSection[]>(NONE)

/** The sections the current variant registered, in display order. */
export function useSettingsSections(): readonly SettingsSection[] {
  return useContext(SettingsSectionsContext)
}
