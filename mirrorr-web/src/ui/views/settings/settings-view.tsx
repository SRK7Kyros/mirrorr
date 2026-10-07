import { useState, type FormEvent } from "react"
import { useMutation } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { changePassword, getErrorMessage, logout, useAuthState } from "@/api"
import { ApiError } from "@/api/client"
import {
  Avatar,
  Banner,
  Button,
  Field,
  IconLogout,
  Input,
  Panel,
  PanelBody,
  PanelHead,
  Tag,
  toast,
} from "@/ui/components"
import { Page } from "@/ui/views/shared/page"
import { useSettingsSections } from "./sections"

export function SettingsView() {
  const sections = useSettingsSections()
  return (
    <Page title="Settings" description="Manage your account.">
      <AccountSection />
      {sections.map(({ id, Component }) => (
        <Component key={id} />
      ))}
    </Page>
  )
}

function AccountSection() {
  const auth = useAuthState()
  const navigate = useNavigate()
  const user = auth.auth?.user ?? null
  const client = auth.auth?.client ?? null
  const displayName =
    user !== null && user.display_name !== ""
      ? user.display_name
      : (user?.username ?? client?.name ?? "Signed in")
  const handle = user !== null ? `@${user.username}` : (client?.name ?? "")
  const role = user?.role ?? (client !== null ? "api-client" : "unknown")

  const [oldPassword, setOldPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({})

  const change = useMutation({
    mutationFn: (input: { readonly oldPassword: string; readonly newPassword: string }) =>
      changePassword(input.oldPassword, input.newPassword),
    onSuccess: () => {
      toast.success("Password changed", "Your session ended — the app will return to the sign-in screen.")
    },
  })

  const signOut = useMutation({
    mutationFn: () => logout(),
    onSettled: () => {
      void navigate({ to: "/login" })
    },
  })

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (change.isPending) return
    setError(null)
    setFieldErrors({})
    if (newPassword !== confirm) {
      setError("Passwords do not match")
      return
    }
    try {
      await change.mutateAsync({ oldPassword, newPassword })
      setOldPassword("")
      setNewPassword("")
      setConfirm("")
    } catch (caught) {
      if (caught instanceof ApiError && caught.fieldErrors !== undefined) setFieldErrors(caught.fieldErrors)
      setError(getErrorMessage(caught, "Could not change password"))
    }
  }

  return (
    <Panel>
      <PanelHead title="Account" />
      <PanelBody>
        <div className="stack">
          <div className="row">
            <Avatar name={displayName} />
            <div className="user-meta">
              <div className="user-name">{displayName}</div>
              {handle !== "" ? <div className="user-role">{handle}</div> : null}
            </div>
            <Tag accent>{role}</Tag>
          </div>

          <hr className="divider" />

          <form className="stack" onSubmit={(event) => void onSubmit(event)} noValidate>
            <h3>Change password</h3>
            {error !== null ? <Banner kind="danger" title={error} /> : null}
            <Field
              label="Current password"
              htmlFor="account-old-password"
              required
              error={fieldErrors.old_password ?? null}
            >
              <Input
                id="account-old-password"
                type="password"
                autoComplete="current-password"
                value={oldPassword}
                onChange={(event) => setOldPassword(event.target.value)}
              />
            </Field>
            <Field
              label="New password"
              htmlFor="account-new-password"
              required
              error={fieldErrors.new_password ?? null}
            >
              <Input
                id="account-new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </Field>
            <Field label="Confirm new password" htmlFor="account-confirm-password" required>
              <Input
                id="account-confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
              />
            </Field>
            <div className="row">
              <Button
                type="submit"
                variant="primary"
                loading={change.isPending}
                disabled={oldPassword === "" || newPassword === "" || confirm === ""}
              >
                Change password
              </Button>
            </div>
          </form>

          <hr className="divider" />

          <div className="row-between">
            <span className="text-muted">End this session on every device.</span>
            <Button
              variant="outline"
              icon={<IconLogout size={16} />}
              loading={signOut.isPending}
              onClick={() => signOut.mutate()}
            >
              Sign out
            </Button>
          </div>
        </div>
      </PanelBody>
    </Panel>
  )
}
