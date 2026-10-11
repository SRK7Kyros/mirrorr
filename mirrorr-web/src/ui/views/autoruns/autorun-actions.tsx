import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  createSession,
  deleteAutorun,
  getErrorMessage,
  removeFromInfiniteLists,
  saveAutorunAsProfile,
  type SessionCreateBody,
} from "@/api"
import { queryKeys, queryRoots } from "@/api/query-keys"
import { getStatusDescriptor } from "@/api/status"
import type { Autorun } from "@/api/schemas"
import {
  Banner,
  Button,
  ConfirmDialog,
  Dialog,
  DropdownMenu,
  Field,
  IconEdit,
  IconPlay,
  IconSave,
  IconTrash,
  Input,
  MenuItem,
  MenuSeparator,
  toast,
} from "@/ui/components"
import { AutorunFormDialog } from "./autorun-form-dialog"

/** `POST /sessions/` body for "Run now" (spec §5.6 — no server run-now endpoint). */
function sessionBodyFor(autorun: Autorun): SessionCreateBody {
  return {
    engine_id: autorun.engine_id,
    resolver_id: autorun.resolver_id,
    recording: autorun.recording === true,
    ...(autorun.profile_id !== null && autorun.profile_id !== undefined
      ? { profile_id: autorun.profile_id }
      : {}),
    ...(autorun.resolver_config !== undefined ? { resolver_config: autorun.resolver_config } : {}),
    ...(autorun.retry_mode !== undefined ? { retry_mode: autorun.retry_mode } : {}),
    ...(autorun.retry_config !== undefined ? { retry_config: autorun.retry_config } : {}),
  }
}

/**
 * Autorun action cluster — every item comes from `STATUS_MAP.autorunActions`
 * (spec §1.4). An action absent from the status set is never rendered (a
 * `remuxing` autorun has no delete item at all).
 */
export function AutorunActionsMenu({ autorun }: { readonly autorun: Autorun }) {
  const queryClient = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [profileName, setProfileName] = useState("")
  const [saveError, setSaveError] = useState<string | null>(null)

  const actions = getStatusDescriptor(autorun.status).autorunActions

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryRoots.autoruns })
    void queryClient.invalidateQueries({ queryKey: queryKeys.autorun(autorun.id) })
  }

  const remove = useMutation({
    mutationFn: () => deleteAutorun(autorun.id),
    onSuccess: () => {
      removeFromInfiniteLists(queryClient, queryRoots.autoruns, autorun.id)
      queryClient.removeQueries({ queryKey: queryKeys.autorun(autorun.id) })
      toast.success("Scheduled recording deleted", autorun.user_friendly_name)
      invalidate()
    },
    onError: (error) =>
      toast.error("Could not delete the scheduled recording", getErrorMessage(error, "Request failed")),
  })

  const runNow = useMutation({
    mutationFn: () => createSession(sessionBodyFor(autorun)),
    onSuccess: (session) => {
      toast.success("Session started", `#${session.id}`)
      void queryClient.invalidateQueries({ queryKey: queryRoots.sessions })
    },
    onError: (error) => toast.error("Could not run now", getErrorMessage(error, "Request failed")),
  })

  const saveAsProfile = useMutation({
    mutationFn: (name: string) => saveAutorunAsProfile(autorun.id, name),
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
      <DropdownMenu label={`Actions for ${autorun.user_friendly_name}`}>
        {actions.includes("edit") ? (
          <MenuItem icon={<IconEdit size={15} />} onClick={() => setEditOpen(true)}>
            Edit
          </MenuItem>
        ) : null}

        {actions.includes("run-now") ? (
          <MenuItem icon={<IconPlay size={15} />} disabled={runNow.isPending} onClick={() => runNow.mutate()}>
            Run now
          </MenuItem>
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
        title="Delete this scheduled recording?"
        description="It will also stop and delete any running recording it started."
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

      <AutorunFormDialog open={editOpen} autorun={autorun} onClose={() => setEditOpen(false)} />

      <Dialog
        open={saveOpen}
        onClose={() => {
          setSaveOpen(false)
          setSaveError(null)
        }}
        title="Save as profile"
        description={`Create a reusable profile from ${autorun.user_friendly_name}.`}
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
        <div className="flex flex-col gap-4">
          {saveError !== null ? <Banner kind="danger" title={saveError} /> : null}
          <Field
            label="Profile name"
            htmlFor={`save-autorun-profile-${autorun.id}`}
            required
            hint="Reusable from the New session dialog."
          >
            <Input
              id={`save-autorun-profile-${autorun.id}`}
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
