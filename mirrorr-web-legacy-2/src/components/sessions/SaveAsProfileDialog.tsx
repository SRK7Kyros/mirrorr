/**
 * Save-as-profile dialog — spec L220: offered on `completed`/`failed`, asks
 * for a name, `POST /sessions/{id}/save-as-profile {name}` on confirm, success
 * toast + `["profiles"]` invalidation, 400 renders inline (duplicate name).
 */
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/Button"
import { Dialog } from "@/components/ui/Dialog"
import { Input } from "@/components/ui/Input"
import { queryClient } from "@/query-client"
import { ApiError, userMessageForError } from "@/lib/errors"
import { queryKeys } from "@/lib/query-keys"
import { saveSessionAsProfile } from "@/lib/sessions-api"
import { showToast } from "@/lib/toast"

export interface SaveAsProfileDialogProps {
  readonly open: boolean
  readonly sessionId: number | null
  readonly onClose: () => void
}

export function SaveAsProfileDialog({ open, sessionId, onClose }: SaveAsProfileDialogProps) {
  const [name, setName] = useState("")
  const [error, setError] = useState<string | undefined>(undefined)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!open) return
    setName("")
    setError(undefined)
    setPending(false)
  }, [open])

  async function submit() {
    if (sessionId === null) return
    const trimmed = name.trim()
    if (trimmed.length === 0) {
      setError("Enter a profile name")
      return
    }

    setPending(true)
    try {
      await saveSessionAsProfile(sessionId, trimmed)
      await queryClient.invalidateQueries({ queryKey: queryKeys.profilesAll(), type: "all" })
      showToast(`Profile "${trimmed}" saved`, "info")
      onClose()
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 400) setError(userMessageForError(caught))
      else showToast(userMessageForError(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Save session #${sessionId ?? ""} as profile`}
      size="confirm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={pending}>
            Save profile
          </Button>
        </>
      }
    >
      <Input
        label="Profile name"
        value={name}
        error={error}
        autoComplete="off"
        onChange={(event) => setName(event.target.value)}
      />
    </Dialog>
  )
}
