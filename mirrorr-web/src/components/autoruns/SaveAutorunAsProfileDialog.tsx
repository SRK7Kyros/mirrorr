/**
 * Save-as-profile dialog for spent autoruns — spec L284-L287 (spent action
 * set) and L220: asks for a name, `POST /autoruns/{id}/save-as-profile`, a
 * success toast + `["profiles"]` invalidation, and an inline 400 (duplicate).
 */
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/Button"
import { Dialog } from "@/components/ui/Dialog"
import { Input } from "@/components/ui/Input"
import { queryClient } from "@/query-client"
import { saveAutorunAsProfile } from "@/lib/autoruns-api"
import { ApiError, userMessageForError } from "@/lib/errors"
import { queryKeys } from "@/lib/query-keys"
import { showToast } from "@/lib/toast"

export interface SaveAutorunAsProfileDialogProps {
  readonly open: boolean
  readonly autorunId: number | null
  readonly onClose: () => void
}

export function SaveAutorunAsProfileDialog({ open, autorunId, onClose }: SaveAutorunAsProfileDialogProps) {
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
    if (autorunId === null) return
    const trimmed = name.trim()
    if (trimmed.length === 0) {
      setError("Enter a profile name")
      return
    }

    setPending(true)
    try {
      await saveAutorunAsProfile(autorunId, trimmed)
      await queryClient.invalidateQueries({ queryKey: queryKeys.profiles() })
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
      title={`Save autorun #${autorunId ?? ""} as profile`}
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
