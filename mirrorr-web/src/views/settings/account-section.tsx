import { useState, type FormEvent } from "react"
import { Badge } from "@/components/ui/Badge"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Switch } from "@/components/ui/Switch"
import { useToast } from "@/components/ui/Toast"
import { changePassword, type AuthState } from "@/lib/auth"
import { ApiError } from "@/lib/api"
import { useAuthState } from "@/hooks/use-auth-state"

/**
 * V11 Account — user card (username 16/600 mono-inline, display name 14
 * secondary, role badge) + change-password form card (400 → inline on
 * old) + notification-prefs card (three 48px switch rows, localStorage).
 * Success → toast "Password changed — sign in again"; `changePassword`
 * already forces the logout flow to /login (server revokes every token).
 */

const API_UNREACHABLE = "API unreachable"
const UNEXPECTED_RESPONSE = "Unexpected server response"
const PASSWORDS_MISMATCH = "Passwords do not match"
const CHANGE_SUCCESS = "Password changed — sign in again"
const MIN_PASSWORD_LENGTH = 8
const MIN_PASSWORD_MESSAGE = "Must be at least 8 characters"

/** Spec/payload leave the storage keys open — first consumer, defaults on. */
const PREF_KEYS = {
  crashes: "mirrorr.pref.toast.crashes",
  completions: "mirrorr.pref.toast.completions",
  recordings: "mirrorr.pref.toast.recordings",
} as const

function readPref(key: string): boolean {
  try {
    return window.localStorage.getItem(key) !== "false"
  } catch {
    return true
  }
}

function writePref(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, String(value))
  } catch {
    // Private-mode storage failure — the toggle state still holds for this session.
  }
}

interface PrefRowProps {
  readonly label: string
  readonly storageKey: string
}

function PrefRow({ label, storageKey }: PrefRowProps) {
  const [checked, setChecked] = useState(() => readPref(storageKey))
  return (
    <div className="settings-pref-row">
      <span className="t-body-strong">{label}</span>
      <Switch
        label={label}
        checked={checked}
        onChange={(next) => {
          setChecked(next)
          writePref(storageKey, next)
        }}
      />
    </div>
  )
}

function IdentityCard({ auth }: { readonly auth: AuthState["auth"] }) {
  if (auth?.user) {
    const { username, display_name: displayName, role } = auth.user
    return (
      <section className="card">
        <p className="card__title t-mono-inline">{username}</p>
        <p className="view-subtitle">{displayName}</p>
        <p>
          <Badge variant={role === "admin" ? "role-admin" : "role-user"}>{role}</Badge>
        </p>
      </section>
    )
  }
  // API-client principal: no password/prefs — banner already lives in AppShell.
  return (
    <section className="card">
      <p className="card__title t-mono-inline">{auth?.client?.name ?? "—"}</p>
      <p className="t-meta">API client</p>
    </section>
  )
}

export function AccountSection() {
  const { auth } = useAuthState()
  const { toast } = useToast()
  const [oldPassword, setOldPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const isUser = auth?.user != null

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setFieldErrors({})
    setFormError(null)
    if (newPassword !== confirmPassword) {
      setFieldErrors({ confirm_password: PASSWORDS_MISMATCH })
      return
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setFieldErrors({ new_password: MIN_PASSWORD_MESSAGE })
      return
    }
    setSubmitting(true)
    try {
      await changePassword(oldPassword, newPassword)
      // changePassword force-logged-out already (navigated to /login);
      // the root-mounted ToastProvider outlives the view, so this lands there.
      toast({ kind: "success", title: CHANGE_SUCCESS })
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 422 && error.fieldErrors) {
          const { _form, ...rest } = error.fieldErrors
          setFieldErrors(rest)
          if (_form !== undefined) setFormError(_form)
        } else if (error.status === 400 && !error.fieldErrors) {
          // Spec V11: 400 (bad current password) → inline on old.
          setFieldErrors({ old_password: error.message })
        } else if (error.status === 0) {
          setFormError(API_UNREACHABLE)
        } else {
          setFormError(error.message)
        }
      } else {
        setFormError(UNEXPECTED_RESPONSE)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="card-stack">
      <IdentityCard auth={auth} />
      {isUser ? (
        <section className="card">
          <form className="stack" onSubmit={handleSubmit} noValidate>
            <Input
              label="Current password"
              type="password"
              autoComplete="current-password"
              enterKeyHint="next"
              value={oldPassword}
              onChange={(event) => setOldPassword(event.target.value)}
              error={fieldErrors.old_password}
              required
              disabled={submitting}
            />
            <Input
              label="New password"
              type="password"
              autoComplete="new-password"
              enterKeyHint="next"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              error={fieldErrors.new_password}
              helper="At least 8 characters"
              required
              disabled={submitting}
            />
            <Input
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              enterKeyHint="done"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              error={fieldErrors.confirm_password}
              required
              disabled={submitting}
            />
            {formError !== null ? (
              <p className="field__helper field__helper--error" role="alert">
                {formError}
              </p>
            ) : null}
            <div>
              <Button type="submit" variant="primary" loading={submitting}>
                Change password
              </Button>
            </div>
          </form>
        </section>
      ) : null}
      {isUser ? (
        <section className="card">
          <p className="card__legend">Notification toasts</p>
          <PrefRow label="Toasts for crashes" storageKey={PREF_KEYS.crashes} />
          <PrefRow label="Toasts for completions" storageKey={PREF_KEYS.completions} />
          <PrefRow label="Toasts for recordings saved" storageKey={PREF_KEYS.recordings} />
        </section>
      ) : null}
    </div>
  )
}
