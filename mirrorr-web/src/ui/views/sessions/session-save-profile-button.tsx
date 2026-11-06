import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { getErrorMessage, saveSessionAsProfile } from "@/api"
import type { Session } from "@/api/schemas"
import { queryRoots } from "@/api/query-keys"
import { getStatusDescriptor } from "@/api/status"
import { Banner, Button, Dialog, Field, IconSave, Input, toast, type ButtonSize } from "@/ui/components"

/**
 * The dialog on its own, so the session detail page can offer "Save as profile"
 * as a `⋯` item — that page has one action surface (plan §2.3), and a second
 * standalone icon button beside the overflow would be two.
 */
export function SessionSaveProfileDialog({
  session,
  open,
  onClose,
}: {
  readonly session: Session
  readonly open: boolean
  readonly onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    onClose()
    setError(null)
  }

  const save = useMutation({
    mutationFn: (profileName: string) => saveSessionAsProfile(session.id, profileName),
    onSuccess: (profile) => {
      toast.success("Profile created", profile.name)
      void queryClient.invalidateQueries({ queryKey: queryRoots.profiles })
      onClose()
      setName("")
    },
    onError: (err) => setError(getErrorMessage(err, "Could not save the profile")),
  })

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Save as profile"
      description={`Create a reusable profile from session #${session.id}.`}
      busy={save.isPending}
      footer={
        <>
          <Button variant="ghost" disabled={save.isPending} onClick={close}>
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
  )
}

/** "Save as profile" as a standalone button — only statuses that set the action see it. */
export function SessionSaveProfileButton({
  session,
  size = "sm",
}: {
  readonly session: Session
  readonly size?: ButtonSize
}) {
  const [open, setOpen] = useState(false)

  if (!getStatusDescriptor(session.status).sessionActions.includes("save-as-profile")) return null

  return (
    <>
      <Button
        variant="ghost"
        size={size}
        icon={<IconSave size={16} />}
        aria-label={`Save session #${session.id} as a profile`}
        title="Save as profile"
        onClick={() => setOpen(true)}
      />
      <SessionSaveProfileDialog session={session} open={open} onClose={() => setOpen(false)} />
    </>
  )
}
