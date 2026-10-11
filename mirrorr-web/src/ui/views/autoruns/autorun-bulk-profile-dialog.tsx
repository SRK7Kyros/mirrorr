import { useEffect, useState } from "react"
import { useProfiles } from "@/api"
import { Button, Dialog, Field, Select } from "@/ui/components"

export interface AutorunBulkProfileDialogProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly count: number
  readonly busy: boolean
  readonly onApply: (profileId: number) => void
}

/**
 * Bulk profile picker — points every selected scheduled recording at one
 * profile. The dialog stays open while the change is in flight so a partial
 * failure can be retried; the caller closes it once the change lands.
 */
export function AutorunBulkProfileDialog({ open, onClose, count, busy, onApply }: AutorunBulkProfileDialogProps) {
  const profiles = useProfiles()
  const [profileId, setProfileId] = useState("")

  useEffect(() => {
    if (open) setProfileId("")
  }, [open])

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      title={`Set the profile on ${count} scheduled recording${count === 1 ? "" : "s"}`}
      description="Each selected recording adopts this profile's engine, resolver and retry policy. Recordings that have already run are skipped."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={profileId === "" || busy}
            loading={busy}
            onClick={() => {
              if (profileId !== "") onApply(Number(profileId))
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
          onChange={(event) => setProfileId(event.target.value)}
        >
          <option value="">Select a profile…</option>
          {profiles.map((profile) => (
            <option key={profile.id} value={String(profile.id)}>
              {profile.name}
            </option>
          ))}
        </Select>
      </Field>
    </Dialog>
  )
}
