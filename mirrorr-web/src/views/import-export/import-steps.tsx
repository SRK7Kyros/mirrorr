import type { Dispatch, SetStateAction } from "react"
import { Badge } from "@/components/ui/Badge"
import { Button } from "@/components/ui/Button"
import { Select } from "@/components/ui/Select"
import { Switch } from "@/components/ui/Switch"
import type { ImportItem } from "@/views/shared/api"
import type { Engine, Profile, Resolver } from "@/lib/schemas"
import { CopyButton, JsonWell } from "@/views/shared/parts"
import {
  BADGE_LABELS,
  issueKind,
  issueOriginHash,
  issuePluginType,
  itemBadge,
  suggestedRename,
  type ItemResolution,
} from "./bundle"

/**
 * V10 wizard step panels (Review / Resolve). Pure presentation — state and
 * mutations live in ImportExportView. Apply still encodes the body locally
 * via `buildApplyBody` in the parent (contract: no second validate).
 */

export interface StepSelectOption {
  readonly value: string
  readonly label: string
}

export interface ReviewStepProps {
  readonly items: readonly ImportItem[]
  readonly included: Record<string, boolean>
  readonly onToggleInclude: (name: string, next: boolean) => void
  readonly onBack: () => void
  readonly onNext: () => void
  readonly onCancel: () => void
}

export function ReviewStep({
  items,
  included,
  onToggleInclude,
  onBack,
  onNext,
  onCancel,
}: ReviewStepProps) {
  return (
    <>
      <table className="entity-table">
        <thead>
          <tr>
            <th scope="col">Include</th>
            <th scope="col">Name</th>
            <th scope="col">Content hash</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={`${item.kind}-${item.name}`} className="entity-row">
              <td data-col="status">
                <Switch
                  label={`Include ${item.name}`}
                  checked={included[item.name] !== false}
                  onChange={(next) => onToggleInclude(item.name, next)}
                />
              </td>
              <td data-col="name" className="cell-strong">
                {item.name}
                <JsonWell value={item.entry} />
              </td>
              <td data-col="enginepair">
                <span className="cluster">
                  <span className="t-mono-inline ellipsis">
                    {item.content_hash == null ? "—" : item.content_hash.slice(0, 12)}
                  </span>
                  {item.content_hash == null ? null : (
                    <CopyButton text={item.content_hash} label="Copy content hash" />
                  )}
                </span>
              </td>
              <td data-col="recording">
                <Badge variant={itemBadge(item) === "ready" ? "capability-true" : "tag"}>
                  {BADGE_LABELS[itemBadge(item)]}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <footer className="list-footer">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button variant="primary" onClick={onNext}>
          Next
        </Button>
      </footer>
    </>
  )
}

export interface ResolveStepProps {
  readonly items: readonly ImportItem[]
  readonly resolutions: Record<string, ItemResolution>
  readonly setResolutions: Dispatch<SetStateAction<Record<string, ItemResolution>>>
  readonly engines: readonly Engine[]
  readonly resolvers: readonly Resolver[]
  readonly profiles: readonly Profile[]
  readonly busy: boolean
  readonly onBack: () => void
  readonly onApply: () => void
  readonly onCancel: () => void
}

function pluginOptions(
  kind: "engine" | "resolver",
  engines: readonly Engine[],
  resolvers: readonly Resolver[],
): StepSelectOption[] {
  return (kind === "engine" ? engines : resolvers).map((entry) => ({
    value: String(entry.id),
    label: entry.name,
  }))
}

/** Apply matches the bind target by profile NAME (bundle.ts: entry.profile = { name }). */
function profileOptions(profiles: readonly Profile[]): StepSelectOption[] {
  return profiles.map((profile) => ({
    value: profile.name,
    label: profile.name,
  }))
}

export function ResolveStep({
  items,
  resolutions,
  setResolutions,
  engines,
  resolvers,
  profiles,
  busy,
  onBack,
  onApply,
  onCancel,
}: ResolveStepProps) {
  return (
    <>
      {items.map((item) => {
        const res = resolutions[item.name] ?? { included: true }
        const rename = suggestedRename(item)
        return (
          <article key={`${item.kind}-${item.name}`} className="card issue-card">
            <h2 className="card__title">{item.name}</h2>
            {item.issues.map((issue, index) => {
              const kind = issueKind(issue)
              const hash = issueOriginHash(issue)
              const type = issuePluginType(issue)
              if (kind === "not_installed" || kind === "hash_mismatch") {
                return (
                  <div key={index} className="stack">
                    <p className="t-meta">
                      {kind === "not_installed" ? "Plugin not installed" : "Plugin hash mismatch"}
                      {hash === null ? "" : ` (${hash.slice(0, 12)})`}
                    </p>
                    <Select
                      label={`Installed ${type}`}
                      placeholder="choose manually"
                      options={pluginOptions(type, engines, resolvers)}
                      value={res.plugin?.id == null ? null : String(res.plugin.id)}
                      onChange={(next) => {
                        setResolutions((current) => ({
                          ...current,
                          [item.name]: {
                            ...(current[item.name] ?? { included: true }),
                            plugin: { type, id: Number(next) },
                            pluginHash: hash ?? undefined,
                          },
                        }))
                      }}
                    />
                  </div>
                )
              }
              if (kind === "name_conflict") {
                return (
                  <p key={index} className="t-mono-inline">
                    {rename === null
                      ? `${item.name} will be auto-renamed`
                      : `${item.name} → ${rename}`}
                  </p>
                )
              }
              if (kind === "profile_missing") {
                return (
                  <div key={index} className="radio-stack">
                    <p className="t-meta">Referenced profile is missing</p>
                    <label className="radio-row">
                      <input
                        type="radio"
                        name={`profile-${item.name}`}
                        checked={res.profile?.mode === "bind"}
                        onChange={() =>
                          setResolutions((current) => ({
                            ...current,
                            [item.name]: {
                              ...(current[item.name] ?? { included: true }),
                              profile: { mode: "bind", profileName: "" },
                            },
                          }))
                        }
                      />
                      Bind to existing profile
                    </label>
                    {res.profile?.mode === "bind" ? (
                      <Select
                        label="Profile"
                        placeholder="choose manually"
                        options={profileOptions(profiles)}
                        value={res.profile.profileName === "" ? null : res.profile.profileName}
                        onChange={(next) =>
                          setResolutions((current) => ({
                            ...current,
                            [item.name]: {
                              ...(current[item.name] ?? { included: true }),
                              profile: { mode: "bind", profileName: next },
                            },
                          }))
                        }
                      />
                    ) : null}
                    <label className="radio-row">
                      <input
                        type="radio"
                        name={`profile-${item.name}`}
                        checked={res.profile?.mode !== "bind"}
                        onChange={() =>
                          setResolutions((current) => ({
                            ...current,
                            [item.name]: {
                              ...(current[item.name] ?? { included: true }),
                              profile: { mode: "inline" },
                            },
                          }))
                        }
                      />
                      Use inline config
                    </label>
                    <p className="t-meta">
                      The autorun keeps its own engine/resolver config — self-contained.
                    </p>
                  </div>
                )
              }
              if (kind === "engine_override") {
                return (
                  <div key={index} className="radio-stack">
                    <p className="t-meta">Autorun engine differs from profile engine</p>
                    <label className="radio-row">
                      <input
                        type="radio"
                        name={`engine-${item.name}`}
                        checked={res.engine?.mode !== "profile"}
                        onChange={() =>
                          setResolutions((current) => ({
                            ...current,
                            [item.name]: {
                              ...(current[item.name] ?? { included: true }),
                              engine: { mode: "keep" },
                            },
                          }))
                        }
                      />
                      Keep autorun engine
                    </label>
                    <label className="radio-row">
                      <input
                        type="radio"
                        name={`engine-${item.name}`}
                        checked={res.engine?.mode === "profile"}
                        onChange={() =>
                          setResolutions((current) => ({
                            ...current,
                            [item.name]: {
                              ...(current[item.name] ?? { included: true }),
                              engine: { mode: "profile" },
                            },
                          }))
                        }
                      />
                      Use profile engine
                    </label>
                  </div>
                )
              }
              return (
                <p key={index} className="t-meta">
                  {String(issue.type)}
                </p>
              )
            })}
            <JsonWell value={item.entry} />
          </article>
        )
      })}
      <footer className="list-footer">
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button variant="primary" loading={busy} onClick={onApply}>
          Apply
        </Button>
      </footer>
    </>
  )
}
