import {
  Field,
  Hash,
  Radio,
  Select,
} from "@/ui/components"
import { issueKind, issueOriginHash, issuePluginType, type ImportItem, type ItemResolution } from "@/api"

export interface LookupOption {
  readonly id: number
  readonly name: string
}

/**
 * Per-item choices the bundle cannot make for the user: map a plugin the
 * installation does not have, or decide what an autorun inherits when its
 * profile is missing or its engine was overridden. Everything else is left to
 * the server, whose validate report is the only source of these questions.
 */
export function ResolutionControls({
  item,
  resolution,
  engines,
  resolvers,
  profiles,
  onChange,
  empty = "dash",
}: {
  readonly item: ImportItem
  readonly resolution: ItemResolution
  readonly engines: readonly LookupOption[]
  readonly resolvers: readonly LookupOption[]
  readonly profiles: readonly LookupOption[]
  readonly onChange: (patch: Partial<ItemResolution>) => void
  /** "dash" keeps the table cell explicit; "none" drops the placeholder from a card. */
  readonly empty?: "dash" | "none"
}) {
  const hashIssues = item.issues.filter((issue) => {
    const kind = issueKind(issue)
    return kind === "not_installed" || kind === "hash_mismatch"
  })
  const profileMissing = item.issues.some((issue) => issueKind(issue) === "profile_missing")
  const engineOverride = item.issues.some((issue) => issueKind(issue) === "engine_override")
  const bound = resolution.profile?.mode === "bind" ? resolution.profile : null

  if (hashIssues.length === 0 && !profileMissing && !engineOverride) {
    return empty === "none" ? null : <span className="text-dim">—</span>
  }

  return (
    <div className="flex flex-col gap-2">
      {hashIssues.map((issue, index) => {
        const type = issuePluginType(issue)
        const hash = issueOriginHash(issue)
        const options = type === "engine" ? engines : resolvers
        const mapped = hash === null ? undefined : resolution.plugins?.[hash]
        const selected = mapped === undefined ? "" : String(mapped.id)
        return (
          <Field
            key={`${type}-${index}`}
            label={`Map ${type}`}
            hint={
              hash === null ? (
                "No origin hash — cannot map this plugin"
              ) : (
                <span className="flex items-center gap-3" style={{ gap: "var(--s-2)" }}>
                  <span>origin hash</span>
                  <Hash value={hash} label={`${item.name} origin hash`} />
                </span>
              )
            }
          >
            <Select
              aria-label={`Map ${type} for ${item.name}`}
              value={selected}
              disabled={hash === null}
              onChange={(event) => {
                if (hash === null || event.target.value === "") return
                onChange({
                  plugins: {
                    ...(resolution.plugins ?? {}),
                    [hash]: { type, id: Number(event.target.value) },
                  },
                })
              }}
            >
              <option value="">{`Select an installed ${type}…`}</option>
              {options.map((option) => (
                <option key={option.id} value={String(option.id)}>
                  {option.name}
                </option>
              ))}
            </Select>
          </Field>
        )
      })}

      {profileMissing ? (
        <div className="flex flex-col gap-2">
          <Radio
            name={`profile-${item.name}`}
            label="Bind to existing profile"
            checked={bound !== null}
            onChange={() =>
              onChange({ profile: { mode: "bind", profileName: profiles[0]?.name ?? "" } })
            }
          />
          {bound !== null ? (
            <Field label="Profile">
              <Select
                aria-label={`Profile for ${item.name}`}
                value={bound.profileName}
                onChange={(event) =>
                  onChange({ profile: { mode: "bind", profileName: event.target.value } })
                }
              >
                <option value="">Select a profile…</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.name}>
                    {profile.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Radio
            name={`profile-${item.name}`}
            label="Inline config"
            checked={resolution.profile?.mode === "inline"}
            onChange={() => onChange({ profile: { mode: "inline" } })}
          />
        </div>
      ) : null}

      {engineOverride ? (
        <div className="flex flex-col gap-2">
          <Radio
            name={`engine-${item.name}`}
            label="Keep autorun engine"
            checked={resolution.engine?.mode === "keep"}
            onChange={() => onChange({ engine: { mode: "keep" } })}
          />
          <Radio
            name={`engine-${item.name}`}
            label="Use profile engine"
            checked={resolution.engine?.mode === "profile"}
            onChange={() => onChange({ engine: { mode: "profile" } })}
          />
        </div>
      ) : null}
    </div>
  )
}
