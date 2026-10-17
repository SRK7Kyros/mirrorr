import { useState, type FormEvent } from "react"
import { useMutation } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { changePassword, getErrorMessage, logout, useAuthState } from "@/api"
import { ApiError } from "@/api/client"
import {
  Avatar,
  Banner,
  Button,
  buttonClass,
  Field,
  IconLogout,
  IconSessions,
  IconSettings,
  Input,
  Panel,
  PanelBody,
  PanelHead,
  Tag,
  toast,
  useFocusScope,
} from "@/ui/components"
import { Page } from "@/ui/views/shared/page"
import { useSettingsSections } from "./sections"

export function SettingsView() {
  const sections = useSettingsSections()
  return (
    <Page title="Settings" description="Manage your account.">
      <AccountSection />
      <ConsoleDoorPanel />
      {sections.map(({ id, Component }) => (
        <Component key={id} />
      ))}
    </Page>
  )
}

/**
 * Door between the app's two builds, pointing the way this one is not. The
 * standard build points at the admin console (`run/admin`, served under
 * `/admin/`), which is linked from nowhere else — without it the registration
 * queue is unreachable for the admins it is meant for. The admin build points
 * back the other way, so an admin who lands there has a way out that is not
 * typing a URL. Either direction is a document hop: it leaves this app for the
 * other build, so neither is a router route.
 */
function ConsoleDoorPanel() {
  const auth = useAuthState()
  if (auth.auth?.user?.role !== "admin") return null
  const door = __ADMIN__
    ? {
        title: "Console",
        blurb: "Sessions, presets, plugins and recordings.",
        href: "/sessions",
        icon: <IconSessions size={16} />,
      }
    : {
        title: "Administration",
        blurb: "Approve sign-ups, manage users and API clients.",
        href: "/admin/settings",
        icon: <IconSettings size={16} />,
      }
  return (
    <Panel>
      <PanelHead title={door.title} />
      <PanelBody>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted">{door.blurb}</span>
          <a className={buttonClass({ variant: "secondary" })} href={door.href}>
            {door.icon}
            <span data-slot="button-label">Open console</span>
          </a>
        </div>
      </PanelBody>
    </Panel>
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
  const scope = useFocusScope<HTMLFormElement>()

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
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Avatar name={displayName} />
            <div className="min-w-0 flex-1">
              <div className="text-base font-medium text-ink truncate">{displayName}</div>
              {handle !== "" ? <div className="text-xs text-ink-dim [font-family:var(--font-mono)]">{handle}</div> : null}
            </div>
            <Tag accent>{role}</Tag>
          </div>

          <hr className="h-px bg-line-subtle border-none" />

          <form
            ref={scope.ref}
            onKeyDown={scope.onKeyDown}
            className="flex flex-col gap-4"
            onSubmit={(event) => void onSubmit(event)}
            noValidate
          >
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
            <div className="flex items-center gap-3">
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

          <hr className="h-px bg-line-subtle border-none" />

          <div className="flex items-center justify-between gap-3">
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
