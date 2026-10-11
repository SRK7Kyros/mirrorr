import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { getErrorMessage, saveSessionAsProfile } from "@/api"
import type { Session } from "@/api/schemas"
import { queryRoots } from "@/api/query-keys"
import { getStatusDescriptor } from "@/api/status"
import { Banner, Button, Dialog, Field, IconSave, Input, toast, type ButtonSize } from "@/ui/components"

/** "Save as profile" as a standalone button — only statuses that set the action see it. */
export function SessionSaveProfileButton({
  session,
  size = "sm",
}: {
  readonly session: Session
  readonly size?: ButtonSize
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: (profileName: string) => saveSessionAsProfile(session.id, profileName),
    onSuccess: (profile) => {
      toast.success("Profile created", profile.name)
      void queryClient.invalidateQueries({ queryKey: queryRoots.profiles })
      setOpen(false)
      setName("")
    },
    onError: (err) => setError(getErrorMessage(err, "Could not save the profile")),
  })

  if (!getStatusDescriptor(session.status).sessionActions.includes("save-as-profile")) return null

  return (
    <>
      <Button
        variant="ghost"
        size={size}
        icon={<IconSave size={16} />}
        aria-label={`Save session #${session.id} as a profile`}
        title="Save as profile"
        onClick={() => {
          setError(null)
          setOpen(true)
        }}
      />
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false)
          setError(null)
        }}
        title="Save as profile"
        description={`Create a reusable profile from session #${session.id}.`}
        busy={save.isPending}
        footer={
          <>
            <Button
              variant="ghost"
              disabled={save.isPending}
              onClick={() => {
                setOpen(false)
                setError(null)
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={save.isPending}
              disabled={name.trim() === ""}
              onClick={() => {
                setError(null)
                save.mutate(name.trim())
              }}
            >
              Save profile
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {error !== null ? <Banner kind="danger" title={error} /> : null}
          <Field
            label="Profile name"
            htmlFor={`save-profile-${session.id}`}
            required
            hint="Reusable from the New session dialog."
          >
            <Input
              id={`save-profile-${session.id}`}
              value={name}
              autoComplete="off"
              placeholder="e.g. nightly-news"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
        </div>
      </Dialog>
    </>
  )
}
