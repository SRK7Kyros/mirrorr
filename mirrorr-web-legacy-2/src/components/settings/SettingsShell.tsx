/**
 * SettingsShell — the shared chrome for the three settings surfaces (spec
 * L46-L48): the "Settings" heading, the tab strip and the surface body.
 */
import type { ReactNode } from "react"
import { SettingsTabs, type SettingsTabId } from "@/components/settings/SettingsTabs"

export interface SettingsShellProps {
  readonly testId: string
  readonly active: SettingsTabId
  readonly children: ReactNode
}

export function SettingsShell({ testId, active, children }: SettingsShellProps) {
  return (
    <main data-testid={testId} className="flex flex-col gap-6">
      <h1 className="text-title font-semibold text-text-primary">Settings</h1>
      <SettingsTabs active={active} />
      {children}
    </main>
  )
}
