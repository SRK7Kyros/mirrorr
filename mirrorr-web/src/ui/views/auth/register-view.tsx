import { useState, type FormEvent, type ReactNode } from "react"
import { useNavigate } from "@tanstack/react-router"
import { getErrorMessage, register } from "@/api"
import { ApiError } from "@/api/client"
import { useAuthStatus } from "@/api/hooks"
import {
  Banner,
  Button,
  buttonClass,
  Field,
  IconCheck,
  Input,
  PasswordInput,
  Skeleton,
} from "@/ui/components"
import { useCapsLock } from "@/ui/hooks"
import { landAfterAuth } from "./landing"
import { AuthError, AuthLink, AuthShell } from "./auth-shell"

const MIN_PASSWORD = 8

export function RegisterView() {
  const navigate = useNavigate()
  const authStatus = useAuthStatus()
  const capsLock = useCapsLock()
  const [username, setUsername] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({})
  const [pending, setPending] = useState(false)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (busy) return
    if (password !== confirm) {
      setError("Passwords do not match")
      return
    }
    setBusy(true)
    setError(null)
    setFieldErrors({})
    try {
      const result = await register(username.trim(), password, displayName.trim())
      if ("status" in result) {
        setPending(true)
        return
      }
      await landAfterAuth(result.user?.role, (to) => navigate({ to }))
    } catch (caught) {
      if (caught instanceof ApiError && caught.fieldErrors !== undefined) setFieldErrors(caught.fieldErrors)
      setError(getErrorMessage(caught, "Registration failed"))
    } finally {
      setBusy(false)
    }
  }

  // First user bootstraps the admin account; anyone after files a request an
  // admin must approve (server answers 202 pending → the banner below).
  const statusKnown = authStatus.isLoading !== true && authStatus.status !== undefined
  const isFirstUser = authStatus.status?.has_users === false
  const longEnough = password.length >= MIN_PASSWORD
  const matches = confirm !== "" && password === confirm

  return (
    <AuthShell
      footer={
        statusKnown ? (
          <>
            <span>{isFirstUser ? "Already set up?" : "Have an account?"}</span>
            <AuthLink to="/login">Sign in</AuthLink>
          </>
        ) : (
          <Skeleton width={160} height={16} />
        )
      }
    >
      {pending ? (
        <div className="flex flex-col gap-4">
          <Banner kind="info" title="Request submitted">
            An administrator must approve <strong>{username.trim()}</strong> before you can sign in. Nothing
            else is needed from you; try signing in again once they have.
          </Banner>
          <a className={buttonClass({ variant: "secondary", block: true, size: "md" })} href="/login">
            Back to sign in
          </a>
        </div>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(event) => void onSubmit(event)} noValidate>
          {statusKnown && !isFirstUser ? (
            <p className="text-sm text-ink-muted">
              This account has to be approved by an administrator before it can sign in.
            </p>
          ) : null}
          <AuthError message={error} />
          <Field label="Username" htmlFor="register-username" required error={fieldErrors.username ?? null}>
            <Input
              id="register-username"
              name="username"
              className="h-11"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </Field>
          <Field label="Display name (optional)" htmlFor="register-display-name" hint="Shown in the sidebar and lists.">
            <Input
              id="register-display-name"
              name="display_name"
              className="h-11"
              autoComplete="name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </Field>
          <Field
            label="Password"
            htmlFor="register-password"
            required
            error={fieldErrors.password ?? null}
            hint={capsLock ? "Caps Lock is on." : undefined}
          >
            <PasswordInput
              id="register-password"
              name="password"
              className="h-11"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Field label="Confirm password" htmlFor="register-confirm" required>
            <PasswordInput
              id="register-confirm"
              name="confirm"
              className="h-11"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </Field>
          <ul className="flex flex-col gap-1 text-sm text-ink-muted">
            <Rule met={longEnough}>At least {MIN_PASSWORD} characters</Rule>
            <Rule met={matches}>Both passwords match</Rule>
          </ul>
          <Button
            type="submit"
            variant="primary"
            block
            className="min-h-11"
            loading={busy}
            disabled={username.trim() === "" || password === "" || confirm === ""}
          >
            {isFirstUser ? "Create account" : "Request access"}
          </Button>
        </form>
      )}
    </AuthShell>
  )
}

function Rule({ met, children }: { readonly met: boolean; readonly children: ReactNode }) {
  return (
    <li className={met ? "flex items-center gap-2 text-success" : "flex items-center gap-2"}>
      <span className="grid size-4 place-content-center rounded-full border border-current" aria-hidden="true">
        {met ? <IconCheck size={11} /> : null}
      </span>
      {children}
      <span className="sr-only">{met ? " — met" : " — not met"}</span>
    </li>
  )
}
