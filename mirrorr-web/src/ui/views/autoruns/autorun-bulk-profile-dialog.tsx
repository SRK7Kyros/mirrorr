import { useEffect, useMemo, useState } from "react"
import { useEngines, useProfiles, useResolvers } from "@/api"
import {
  chainOf,
  normaliseRung,
  profileBase,
  resolveChain,
  type ChainBase,
  type ChainCatalog,
  type FallbackRung,
} from "@/api/domain/fallback-chain"
import { Button, Dialog, Field, Select } from "@/ui/components"
import { ChainEditor } from "@/ui/views/shared/chain-editor"

export interface AutorunBulkProfileDialogProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly count: number
  readonly busy: boolean
  readonly onApply: (profileId: number, chain: readonly FallbackRung[]) => void
}

/**
 * Bulk profile picker — points every selected scheduled recording at one
 * profile, with the chain that run tries after its own capture. The chain
 * starts as the profile's own and is edited here, so one action can set a run's
 * whole source list across the selection.
 *
 * The dialog stays open while the change is in flight so a partial failure can
 * be retried; the caller closes it once the change lands.
 */
export function AutorunBulkProfileDialog({
  open,
  onClose,
  count,
  busy,
  onApply,
}: AutorunBulkProfileDialogProps) {
  const profiles = useProfiles()
  const engines = useEngines()
  const resolvers = useResolvers()
  const [profileId, setProfileId] = useState("")
  const [chain, setChain] = useState<FallbackRung[]>([])

  useEffect(() => {
    if (open) {
      setProfileId("")
      setChain([])
    }
  }, [open])

  const catalog = useMemo<ChainCatalog>(
    () => ({ profiles, engines, resolvers }),
    [profiles, engines, resolvers],
  )
  const profile = profiles.find((item) => String(item.id) === profileId)
  const base = useMemo<ChainBase | null>(
    () => (profile === undefined ? null : profileBase(profile)),
    [profile],
  )
  const chainTrouble = base === null ? null : resolveChain(chain, base, catalog).problem

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
              if (profileId !== "") onApply(Number(profileId), chain.map(normaliseRung))
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
            setChain(picked === undefined ? [] : chainOf(picked))
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

      {base === null ? null : (
        <ChainEditor
          idPrefix="bulk-autorun"
          catalog={catalog}
          base={base}
          value={chain}
          onChange={setChain}
          disabled={busy}
          subject="profile"
        />
      )}
    </Dialog>
  )
}
