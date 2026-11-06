import { useState, type FormEvent } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { changePassword, fetchClients, fetchRegistrationRequests, fetchUsers, getErrorMessage, logout, useAuthState } from "@/api"
import { ApiError } from "@/api/client"
import { queryKeys, staleTimes } from "@/api/query-keys"
import {
  Avatar,
  Button,
  buttonClass,
  Field,
  IconLogout,
  IconSessions,
  IconSettings,
  PasswordInput,
  Panel,
  PanelBody,
  PanelHead,
  Skeleton,
  StatLine,
  Tag,
  toast,
} from "@/ui/components"
import { Page } from "@/ui/views/shared/page"
import { useSettingsSections } from "./sections"

export function SettingsView() {
  const sections = useSettingsSections()
  return (
    <Page title="Settings" description="Your account, your password, and where administration lives.">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <AccountCard />
        <PasswordCard />
        <SessionCard />
      </div>
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
  const isAdmin = auth.auth?.user?.role === "admin"

  // The summary is the reason the door is worth opening: three numbers an admin
  // acts on (pending approvals, active users, API clients). It is fetched only
  // for admins — a non-admin would get a 403 that says nothing about this page.
  const users = useQuery({
    queryKey: queryKeys.users,
    queryFn: fetchUsers,
    staleTime: staleTimes.users,
    enabled: isAdmin,
  })
  const clients = useQuery({
    queryKey: queryKeys.clients,
    queryFn: fetchClients,
    staleTime: staleTimes.clients,
    enabled: isAdmin,
  })
  const requests = useQuery({
    queryKey: ["admin", "registration-requests"] as const,
    queryFn: fetchRegistrationRequests,
    staleTime: staleTimes.users,
    enabled: isAdmin,
  })

  if (!isAdmin) return null
  const door = __ADMIN__
    ? { title: "Console", blurb: "Sessions, autoruns, plugins and recordings.", href: "/sessions", icon: <IconSessions size={16} /> }
    : {
        title: "Administration",
        blurb: "Approve sign-ups, manage users and API clients.",
        href: "/admin/settings",
        icon: <IconSettings size={16} />,
      }

  const counts =
    users.data === undefined || clients.data === undefined || requests.data === undefined
      ? null
      : [
          plural(users.data.length, "user"),
          `${requests.data.length} pending`,
          plural(clients.data.length, "API client"),
        ]
  const failed = users.isError || clients.isError || requests.isError

  return (
    <Panel>
      <PanelHead title={door.title} />
      <PanelBody>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-ink-muted">{door.blurb}</span>
            {failed ? (
              <span className="text-sm text-ink-dim">Counts are unavailable right now.</span>
            ) : counts !== null ? (
              <StatLine items={counts} />
            ) : (
              <Skeleton width={230} height={14} />
            )}
          </div>
          <a className={buttonClass({ variant: "secondary", size: "lg" })} href={door.href}>
            {door.icon}
            <span data-slot="button-label">Open {door.title.toLowerCase()}</span>
          </a>
        </div>
      </PanelBody>
    </Panel>
  )
}

function identityOf(auth: ReturnType<typeof useAuthState>["auth"]) {
  const user = auth?.user ?? null
  const client = auth?.client ?? null
  const displayName =
    user !== null && user.display_name !== ""
      ? user.display_name
      : (user?.username ?? client?.name ?? "Signed in")
  return {
    displayName,
    handle: user !== null ? `@${user.username}` : (client?.name ?? ""),
    role: user?.role ?? (client !== null ? "api-client" : "unknown"),
  }
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

function AccountCard() {
  const auth = useAuthState()
  const { displayName, handle, role } = identityOf(auth.auth)

  return (
    <Panel>
      <PanelHead title="Account" />
      <PanelBody>
        <div className="flex items-center gap-3">
          <Avatar name={displayName} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-md font-semibold text-ink">{displayName}</div>
            {handle !== "" ? (
              <div className="truncate text-sm text-ink-muted [font-family:var(--font-mono)]">{handle}</div>
            ) : null}
          </div>
          <Tag accent>{role}</Tag>
        </div>
        <p className="mt-3 text-sm text-ink-muted">
          Your name and handle are shown in the sidebar and in every list that records who did something.
        </p>
      </PanelBody>
    </Panel>
  )
}

function PasswordCard() {
  const [oldPassword, setOldPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({})
  const [done, setDone] = useState(false)

  const change = useMutation({
    mutationFn: (input: { readonly oldPassword: string; readonly newPassword: string }) =>
      changePassword(input.oldPassword, input.newPassword),
    onSuccess: () => {
      setDone(true)
      toast.success("Password changed", "Your other sessions were ended.")
    },
  })

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (change.isPending) return
    setError(null)
    setFieldErrors({})
    setDone(false)
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
      <PanelHead title="Password" />
      <PanelBody>
        <form className="flex flex-col gap-4" onSubmit={(event) => void onSubmit(event)} noValidate>
          <p className="text-sm text-ink-muted">At least 8 characters. Changing it ends your other sessions.</p>
          <Field
            label="Current password"
            htmlFor="account-old-password"
            required
            error={fieldErrors.old_password ?? null}
          >
            <PasswordInput
              id="account-old-password"
              className="h-11"
              autoComplete="current-password"
              value={oldPassword}
              onChange={(event) => setOldPassword(event.target.value)}
            />
          </Field>
          <Field label="New password" htmlFor="account-new-password" required error={fieldErrors.new_password ?? null}>
            <PasswordInput
              id="account-new-password"
              className="h-11"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </Field>
          <Field label="Confirm new password" htmlFor="account-confirm-password" required>
            <PasswordInput
              id="account-confirm-password"
              className="h-11"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </Field>
          <p aria-live="polite" className="min-h-5 text-sm text-danger">
            {error ?? ""}
          </p>
          <p aria-live="polite" className="min-h-5 text-sm text-success">
            {done ? "Password updated. Use it the next time you sign in." : ""}
          </p>
          <Button
            type="submit"
            variant="primary"
            loading={change.isPending}
            disabled={oldPassword === "" || newPassword === "" || confirm === ""}
          >
            Update password
          </Button>
        </form>
      </PanelBody>
    </Panel>
  )
}

function SessionCard() {
  const navigate = useNavigate()
  const signOut = useMutation({
    mutationFn: () => logout(),
    onSettled: () => {
      void navigate({ to: "/login" })
    },
  })

  return (
    <Panel>
      <PanelHead title="Sessions" />
      <PanelBody>
        <p className="text-sm text-ink-muted">
          Signing out ends this session on this device. Your recordings keep running on the server.
        </p>
        <div className="mt-4">
          <Button
            variant="outline"
            icon={<IconLogout size={16} />}
            loading={signOut.isPending}
            onClick={() => signOut.mutate()}
          >
            Sign out
          </Button>
        </div>
      </PanelBody>
    </Panel>
  )
}
