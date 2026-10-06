import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  deleteSession,
  getErrorMessage,
  removeFromInfiniteLists,
  saveSessionAsProfile,
  setSessionRecording,
  stopSession,
  useEngines,
} from "@/api"
import type { Session } from "@/api/schemas"
import { queryKeys, queryRoots } from "@/api/query-keys"
import { getStatusDescriptor } from "@/api/status"
import {
  Banner,
  Button,
  ConfirmDialog,
  Dialog,
  DropdownMenu,
  Field,
  IconDisc,
  IconSave,
  IconStop,
  IconTrash,
  Input,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  toast,
} from "@/ui/components"

/**
 * Session action cluster — every item comes from `STATUS_MAP.sessionActions`
 * (spec §1.4). An action absent from the status set is never rendered (delete
 * during `remuxing` is hidden, not disabled). Recording toggles are replaced by
 * an inline reason when the engine declares `capabilities.can_record === false`.
 */
export function SessionActionsMenu({ session }: { readonly session: Session }) {
  const queryClient = useQueryClient()
  const engines = useEngines()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [profileName, setProfileName] = useState("")
  const [saveError, setSaveError] = useState<string | null>(null)

  const actions = getStatusDescriptor(session.status).sessionActions
  const engine = engines.find((item) => item.id === session.engine_id)
  const canRecord = engine === undefined || engine.capabilities?.can_record !== false
  const wantsRecording = actions.includes("enable-recording") || actions.includes("disable-recording")
  const enableRecording = actions.includes("enable-recording")

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryRoots.sessions })
    void queryClient.invalidateQueries({ queryKey: queryKeys.session(session.id) })
  }

  const stop = useMutation({
    mutationFn: () => stopSession(session.id),
    onSuccess: () => {
      toast.success("Stopping session", `#${session.id}`)
      invalidate()
    },
    onError: (error) => toast.error("Could not stop the session", getErrorMessage(error, "Request failed")),
  })

  const record = useMutation({
    mutationFn: (enable: boolean) => setSessionRecording(session.id, enable),
    onSuccess: (_data, enable) => {
      toast.success(enable ? "Recording enabled" : "Recording disabled", `#${session.id}`)
      invalidate()
    },
    onError: (error) => toast.error("Could not change recording", getErrorMessage(error, "Request failed")),
  })

  const remove = useMutation({
    mutationFn: () => deleteSession(session.id),
    onSuccess: () => {
      removeFromInfiniteLists(queryClient, queryRoots.sessions, session.id)
      queryClient.removeQueries({ queryKey: queryKeys.session(session.id) })
      toast.success("Session deleted", `#${session.id}`)
      invalidate()
    },
    onError: (error) => toast.error("Could not delete the session", getErrorMessage(error, "Request failed")),
  })

  const saveAsProfile = useMutation({
    mutationFn: (name: string) => saveSessionAsProfile(session.id, name),
    onSuccess: (profile) => {
      toast.success("Profile created", profile.name)
      void queryClient.invalidateQueries({ queryKey: queryRoots.profiles })
      setSaveOpen(false)
      setProfileName("")
    },
    onError: (error) => setSaveError(getErrorMessage(error, "Could not save the profile")),
  })

  return (
    <>
      <DropdownMenu label={`Actions for session #${session.id}`}>
        {actions.includes("stop") ? (
          <MenuItem icon={<IconStop size={15} />} disabled={stop.isPending} onClick={() => stop.mutate()}>
            Stop
          </MenuItem>
        ) : null}

        {wantsRecording ? (
          canRecord ? (
            <MenuItem
              icon={<IconDisc size={15} />}
              disabled={record.isPending}
              onClick={() => record.mutate(enableRecording)}
            >
              {enableRecording ? "Enable recording" : "Disable recording"}
            </MenuItem>
          ) : (
            <MenuLabel>Recording unavailable — engine cannot record</MenuLabel>
          )
        ) : null}

        {actions.includes("save-as-profile") ? (
          <MenuItem
            icon={<IconSave size={15} />}
            onClick={() => {
              setSaveError(null)
              setSaveOpen(true)
            }}
          >
            Save as profile
          </MenuItem>
        ) : null}

        {actions.includes("delete") ? (
          <>
            <MenuSeparator />
            <MenuItem icon={<IconTrash size={15} />} danger onClick={() => setConfirmDelete(true)}>
              Delete
            </MenuItem>
          </>
        ) : null}
      </DropdownMenu>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete session #${session.id}?`}
        description="This removes the session record. Recordings already written to disk are kept."
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          try {
            await remove.mutateAsync()
          } catch {
            // onError surfaced a toast; keep the dialog open for a retry.
          }
        }}
      />

      <Dialog
        open={saveOpen}
        onClose={() => {
          setSaveOpen(false)
          setSaveError(null)
        }}
        title="Save as profile"
        description={`Create a reusable profile from session #${session.id}.`}
        busy={saveAsProfile.isPending}
        footer={
          <>
            <Button
              variant="ghost"
              disabled={saveAsProfile.isPending}
              onClick={() => {
                setSaveOpen(false)
                setSaveError(null)
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={saveAsProfile.isPending}
              disabled={profileName.trim() === ""}
              onClick={() => {
                setSaveError(null)
                saveAsProfile.mutate(profileName.trim())
              }}
            >
              Save profile
            </Button>
          </>
        }
      >
        <div className="stack">
          {saveError !== null ? <Banner kind="danger" title={saveError} /> : null}
          <Field
            label="Profile name"
            htmlFor={`save-profile-${session.id}`}
            required
            hint="Reusable from the New session dialog."
          >
            <Input
              id={`save-profile-${session.id}`}
              value={profileName}
              autoComplete="off"
              placeholder="e.g. nightly-news"
              onChange={(event) => setProfileName(event.target.value)}
            />
          </Field>
        </div>
      </Dialog>
    </>
  )
}
