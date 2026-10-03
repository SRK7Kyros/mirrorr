import { useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { Badge } from "@/components/ui/Badge"
import { Button } from "@/components/ui/Button"
import { ErrorPanel } from "@/components/ui/ErrorPanel"
import { Input } from "@/components/ui/Input"
import { Skeleton } from "@/components/ui/Skeleton"
import { useToast } from "@/components/ui/Toast"
import { ApiError, apiFetch, refreshSession } from "@/lib/api"
import { changePassword, currentAuth, forceLogout } from "@/lib/auth"
import type { AuthResponse } from "@/lib/schemas"
import { queryKeys, staleTimes } from "@/lib/query-keys"
import { getErrorMessage } from "./settings-util"
import "@/styles/views-admin.css"

const PASSWORD_HELPER = "Changing your password signs you out everywhere."

interface MeState {
  readonly username: string
  readonly displayName: string
  readonly role: string
}

/**
 * §5.11 Settings — Account. Reads `GET /auth/me`, primary action is the
 * change-password form (`POST /auth/change-password`, which invalidates every
 * access token → force re-login).
 */
export function AccountSection() {
  const navigate = useNavigate()
  const toast = useToast()
  const meQuery = useQuery({
    queryKey: queryKeys.authMe,
    queryFn: () => apiFetch<AuthResponse>("/auth/me"),
    staleTime: staleTimes.authMe,
  })

  const [oldPassword, setOldPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const sessionUser = currentAuth()?.user ?? null
  const me: MeState = {
    username: meQuery.data?.user?.username ?? sessionUser?.username ?? "—",
    displayName: meQuery.data?.user?.display_name ?? sessionUser?.display_name ?? "—",
    role: meQuery.data?.user?.role ?? sessionUser?.role ?? "user",
  }

  const mismatch = confirmPassword !== "" && confirmPassword !== newPassword
  const canSubmit = oldPassword !== "" && newPassword !== "" && confirmPassword !== "" && !mismatch

  const submit = async (): Promise<void> => {
    if (!canSubmit || submitting) return
    setSubmitting(true)
    setFieldErrors({})
    setFormError(null)
    try {
      await changePassword(oldPassword, newPassword)
      toast.toast({ kind: "success", title: "Password changed — please sign in again" })
      await navigate({ to: "/login" })
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 422 && error.fieldErrors !== undefined) {
          const { _form, ...rest } = error.fieldErrors
          setFieldErrors(rest)
          if (_form !== undefined) setFormError(_form)
        } else if (error.status === 400) {
          setFieldErrors((current) => ({ ...current, old_password: error.message }))
        } else setFormError(getErrorMessage(error, "Could not change the password"))
      } else {
        setFormError(getErrorMessage(error, "Could not change the password"))
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (meQuery.isLoading) {
    return (
      <div className="settings-panel panel opaque" aria-busy="true" aria-label="Loading account">
        <Skeleton geometry="row" />
        <Skeleton geometry="row" />
        <Skeleton geometry="row" />
      </div>
    )
  }

  return (
    <div className="settings-panel panel opaque">
      <div className="adm-panel__head">
        <div className="adm-stack">
          <h2 className="t-h3">Account</h2>
          <p className="t-body adm-muted adm-measure">{me.displayName}</p>
        </div>
        <Badge variant={me.role === "admin" ? "role-admin" : "role-user"}>{me.role}</Badge>
      </div>
      <dl className="adm-row">
        <dt className="t-label-caps adm-muted">Username</dt>
        <dd className="t-mono">{me.username}</dd>
      </dl>
      <hr className="adm-divide" />
      <form
        className="auth-form"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        noValidate
      >
        <h3 className="t-h3">Change password</h3>
        {formError !== null ? <ErrorPanel title={formError} /> : null}
        <Input
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={oldPassword}
          onChange={(event) => setOldPassword(event.target.value)}
          error={fieldErrors.old_password}
          disabled={submitting}
          required
        />
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          error={fieldErrors.new_password}
          helper={PASSWORD_HELPER}
          disabled={submitting}
          required
        />
        <Input
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          error={mismatch ? "Passwords do not match" : fieldErrors.confirm_password}
          disabled={submitting}
          required
        />
        <Button type="submit" variant="primary" loading={submitting} disabled={!canSubmit || submitting}>
          Change password
        </Button>
      </form>
      <hr className="adm-divide" />
      <div className="adm-row">
        <Button
          variant="secondary"
          onClick={() => {
            void refreshSession()
            forceLogout()
            void navigate({ to: "/login" })
          }}
        >
          Sign out
        </Button>
      </div>
    </div>
  )
}
