/**
 * V11 — Settings: Account (`/settings`).
 *
 * Contract: `docs/web-frontend-spec.md` L364-L373, L156 (change-password 200
 * forces logout), `docs/general-client-specification.md` §10.1. The user card
 * reads the auth store; the notification preferences are local (localStorage)
 * and gate the pushed-frame toasts (spec L195).
 */
import { useId, useState, type FormEvent } from "react"
import { KeyRound } from "lucide-react"
import { RoleBadge } from "@/components/settings/RoleBadge"
import { SettingsShell } from "@/components/settings/SettingsShell"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Switch } from "@/components/ui/Switch"
import { getAuthState, changePasswordAndSignOut } from "@/lib/auth-store"
import { ApiError, userMessageForError } from "@/lib/errors"
import {
  readNotificationPrefs,
  writeNotificationPrefs,
  type NotificationPrefs,
} from "@/lib/notification-policy"
import { showToast } from "@/lib/toast"

const PASSWORD_MISMATCH_MESSAGE = "Passwords do not match"
const PASSWORD_REQUIRED_MESSAGE = "Enter your current and new password"

const PREFERENCE_ROWS: ReadonlyArray<{ key: keyof NotificationPrefs; label: string }> = [
  { key: "crashes", label: "Crashes" },
  { key: "completions", label: "Completions" },
  { key: "recordings", label: "Recordings" },
]

interface PasswordFieldErrors {
  readonly old?: string
  readonly next?: string
  readonly confirm?: string
}

export function SettingsAccountView() {
  const user = getAuthState().user
  const headingId = useId()
  const [oldPassword, setOldPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [fieldErrors, setFieldErrors] = useState<PasswordFieldErrors>({})
  const [pending, setPending] = useState(false)
  const [prefs, setPrefs] = useState<NotificationPrefs>(() => readNotificationPrefs())

  const displayName = user?.display_name ?? null

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (oldPassword.length === 0 || newPassword.length === 0) {
      setFieldErrors({ next: PASSWORD_REQUIRED_MESSAGE })
      return
    }
    if (newPassword !== confirmPassword) {
      setFieldErrors({ confirm: PASSWORD_MISMATCH_MESSAGE })
      return
    }

    setFieldErrors({})
    setPending(true)
    try {
      await changePasswordAndSignOut(oldPassword, newPassword)
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        setFieldErrors({ old: error.detail })
        return
      }
      showToast(userMessageForError(error), "error")
    } finally {
      setPending(false)
    }
  }

  function updatePreference(key: keyof NotificationPrefs, value: boolean) {
    const next = { ...prefs, [key]: value }
    setPrefs(next)
    writeNotificationPrefs(next)
  }

  return (
    <SettingsShell testId="settings-view" active="account">
      <section
        data-testid="settings-user-card"
        aria-labelledby={headingId}
        className="flex items-center gap-4 rounded-surface border border-border bg-bg-raised p-4"
      >
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-bg-overlay text-title font-semibold text-text-primary"
        >
          {(displayName ?? user?.username ?? "?").slice(0, 1).toUpperCase()}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p id={headingId} data-testid="user-card-username" className="truncate text-title font-semibold text-text-primary">
            {user?.username ?? "Unknown user"}
          </p>
          {displayName !== null ? (
            <p data-testid="user-card-display-name" className="truncate text-body text-text-secondary">
              {displayName}
            </p>
          ) : null}
        </div>
        <span className="ml-auto">{user !== null ? <RoleBadge role={user.role} /> : null}</span>
      </section>

      <section className="flex flex-col gap-3 rounded-surface border border-border bg-bg-raised p-4">
        <h2 className="text-title font-semibold text-text-primary">Change password</h2>
        <form className="flex max-w-sm flex-col gap-3" onSubmit={onSubmit} noValidate>
          <Input
            label="Old password"
            type="password"
            autoComplete="current-password"
            value={oldPassword}
            error={fieldErrors.old}
            onChange={(event) => setOldPassword(event.target.value)}
          />
          <Input
            label="New password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            error={fieldErrors.next}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <Input
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            error={fieldErrors.confirm}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
          <div>
            <Button type="submit" variant="primary" icon={KeyRound} disabled={pending}>
              Change password
            </Button>
          </div>
        </form>
      </section>

      <section className="flex flex-col gap-3 rounded-surface border border-border bg-bg-raised p-4">
        <h2 className="text-title font-semibold text-text-primary">Notifications</h2>
        <p className="text-body text-text-secondary">
          Choose which pushed events raise a toast. Preferences are stored in this browser.
        </p>
        <div className="flex flex-col gap-3">
          {PREFERENCE_ROWS.map((row) => (
            <Switch
              key={row.key}
              label={row.label}
              checked={prefs[row.key]}
              onCheckedChange={(checked) => updatePreference(row.key, checked)}
            />
          ))}
        </div>
      </section>
    </SettingsShell>
  )
}
