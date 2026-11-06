import { useState } from "react"
import type { Autorun } from "@/api/schemas"
import {
  IconChevronRight,
  JsonView,
  Panel,
  PanelBody,
  panelHeadClass,
  panelTitleClass,
} from "@/ui/components"
import { cn } from "@/ui/lib/cn"
import { FactRow } from "./autorun-detail-facts"

/**
 * What this autorun copied when it was created — profile, engine, resolver, the
 * recording flag, the fallback chain and the retry settings. It is a disclosure,
 * not a third status panel: everything here is stable configuration, so it is
 * collapsed unless the record is flagged (then the reason is above and the row
 * that needs replacing is one click away).
 */
export interface AutorunConfigPanelProps {
  readonly autorun: Autorun
  readonly engine: string
  readonly resolver: string
  readonly profile: string
  readonly fallbacks: readonly string[]
}

function retryLabel(mode: string | undefined): string {
  return mode === undefined || mode === "" ? "—" : mode
}

export function AutorunConfigPanel({
  autorun,
  engine,
  resolver,
  profile,
  fallbacks,
}: AutorunConfigPanelProps) {
  const flagged = (autorun.issue ?? "") !== ""
  const [open, setOpen] = useState(flagged)
  const hasResolverConfig =
    autorun.resolver_config !== undefined && Object.keys(autorun.resolver_config).length > 0
  const hasRetryConfig =
    autorun.retry_config !== undefined && Object.keys(autorun.retry_config).length > 0

  return (
    <Panel>
      <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary
          className={cn(
            panelHeadClass,
            "cursor-pointer list-none [&::-webkit-details-marker]:hidden",
          )}
        >
          <h2 className={panelTitleClass}>Config</h2>
          <span className="flex items-center gap-2 text-sm text-dim">
            {flagged ? <span className="text-warning">Needs a profile</span> : null}
            <IconChevronRight
              size={15}
              className={cn("transition-transform duration-[var(--dur-fast)]", open && "rotate-90")}
            />
          </span>
        </summary>
        <PanelBody>
          <dl className="flex flex-col gap-3">
            <FactRow label="Profile">{profile}</FactRow>
            <FactRow label="Engine">{engine}</FactRow>
            <FactRow label="Resolver">{resolver}</FactRow>
            <FactRow label="Recording">{autorun.recording === true ? "On" : "Off"}</FactRow>
            <FactRow label="Fallbacks">
              {fallbacks.length === 0 ? "—" : fallbacks.join(" → ")}
            </FactRow>
            <FactRow label="Retry mode">{retryLabel(autorun.retry_mode)}</FactRow>
            {__ADMIN__ ? (
              <FactRow label="Owner">
                {(autorun.requester_user_token ?? "") === "" ? "—" : autorun.requester_user_token}
              </FactRow>
            ) : null}
          </dl>
          {hasResolverConfig && autorun.resolver_config !== undefined ? (
            <div className="mt-4">
              <JsonView label="Resolver config" value={autorun.resolver_config} defaultOpen />
            </div>
          ) : null}
          {hasRetryConfig && autorun.retry_config !== undefined ? (
            <div className="mt-4">
              <JsonView label="Retry config" value={autorun.retry_config} defaultOpen />
            </div>
          ) : null}
        </PanelBody>
      </details>
    </Panel>
  )
}
