import { useEffect, useState } from "react"
import { useProfiles, useResolvers } from "@/api"
import { chainProblem, type FallbackSource } from "@/api/domain/fallback-sources"
import { Button, Dialog, Field, Select } from "@/ui/components"
import { FallbackSources } from "@/ui/views/shared/source-chain"

export interface AutorunBulkProfileDialogProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly count: number
  readonly busy: boolean
  readonly onApply: (profileId: number, fallbackSources: readonly FallbackSource[]) => void
}

/**
 * Bulk profile picker — points every selected scheduled recording at one
 * profile, with the chain of sources that run tries after its own. The chain
 * starts as the profile's own and is edited here, so one action can set both
 * halves of a run's source list across the whole selection.
 *
 * The dialog stays open while the change is in flight so a partial failure can
 * be retried; the caller closes it once the change lands.
 */
export function AutorunBulkProfileDialog({ open, onClose, count, busy, onApply }: AutorunBulkProfileDialogProps) {
  const profiles = useProfiles()
  const resolvers = useResolvers()
  const [profileId, setProfileId] = useState("")
  const [chain, setChain] = useState<FallbackSource[]>([])

  useEffect(() => {
    if (open) {
      setProfileId("")
      setChain([])
    }
  }, [open])

  const profile = profiles.find((item) => String(item.id) === profileId)
  const chainTrouble =
    profile === undefined
      ? null
      : chainProblem(chain, {
          resolver_id: profile.resolver_id,
          resolver_config: profile.resolver_config ?? {},
        })

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      size="lg"
      title={`Set the profile on ${count} scheduled recording${count === 1 ? "" : "s"}`}
      description="Each selected recording adopts this profile's engine, resolver, retry policy and fallback chain. Recordings that have already run are skipped."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={profileId === "" || busy || chainTrouble !== null}
            loading={busy}
            onClick={() => {
              if (profileId !== "") onApply(Number(profileId), chain)
            }}
          >
            Set profile
          </Button>
        </>
      }
    >
      <Field
        label="Profile"
        htmlFor="bulk-autorun-profile"
        required
        hint={profiles.length === 0 ? "No profiles yet — create one first." : undefined}
      >
        <Select
          id="bulk-autorun-profile"
          value={profileId}
          disabled={profiles.length === 0 || busy}
          onChange={(event) => {
            const picked = profiles.find((item) => String(item.id) === event.target.value)
            setProfileId(event.target.value)
            setChain([...(picked?.fallback_sources ?? [])])
          }}
        >
          <option value="">Select a profile…</option>
          {profiles.map((profile) => (
            <option key={profile.id} value={String(profile.id)}>
              {profile.name}
            </option>
          ))}
        </Select>
      </Field>

      {profile === undefined ? null : (
        <FallbackSources
          resolvers={resolvers}
          value={chain}
          onChange={setChain}
          primary={{ resolver_id: profile.resolver_id, resolver_config: profile.resolver_config ?? {} }}
          subject="profile"
          disabled={busy}
        />
      )}
    </Dialog>
  )
}
