import { Navigate, useLocation, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import type { FormEvent } from "react"
import { Button } from "@/components/ui/Button"
import { ErrorPanel } from "@/components/ui/ErrorPanel"
import { Input } from "@/components/ui/Input"
import { useAuthStatus } from "@/hooks/use-auth-status"
import { useRateLimitLock } from "@/hooks/use-rate-limit-lock"
import { ApiError } from "@/lib/api"
import { login, sanitizeRedirectPath } from "@/lib/auth"
import { AuthFrame, AuthSplash, LOGIN_LOCK_MS, RATE_LIMIT_TITLE } from "./auth-frame"
import "@/styles/views-admin.css"

const WRONG_CREDENTIALS = "Wrong username or password."
const UNREACHABLE = "Cannot reach the recorder — retry"
const UNEXPECTED = "Unexpected server response"

/**
 * §5.1 Auth — Login. `GET /auth/status` drives first-run branching, `POST
 * /auth/login` is the primary. 401 inlines under the password, 429 locks the
 * submit with a live countdown, connectivity failures take the retry panel.
 */
export function LoginView() {
  const navigate = useNavigate()
  const location = useLocation()
  const authStatus = useAuthStatus()
  const { locked, remainingSeconds, lock } = useRateLimitLock(LOGIN_LOCK_MS)
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({})
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [unreachable, setUnreachable] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const redirectTarget =
    sanitizeRedirectPath((location.search as { redirect?: unknown }).redirect) ?? "/sessions"

  if (authStatus.isLoading) return <AuthSplash title="Sign in" />
  // Empty: no users yet → the bootstrap register surface owns first-run.
  if (authStatus.status?.has_users === false) return <Navigate to="/register" />

  const submit = async (): Promise<void> => {
    if (submitting || locked) return
    setSubmitting(true)
    setFieldErrors({})
    setPasswordError(null)
    setFormError(null)
    setUnreachable(false)
    try {
      await login(username, password)
      await navigate({ to: redirectTarget })
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 401) setPasswordError(WRONG_CREDENTIALS)
        else if (error.status === 429) lock()
        else if (error.status === 0 || error.status >= 500) setUnreachable(true)
        else if (error.status === 422 && error.fieldErrors !== undefined) {
          const { _form, ...rest } = error.fieldErrors
          setFieldErrors(rest)
          if (_form !== undefined) setFormError(_form)
        } else setFormError(error.message)
      } else {
        setFormError(UNEXPECTED)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void submit()
  }

  const disabled = submitting || locked

  return (
    <AuthFrame
      title="Sign in"
      footnote={
        <p className="t-body adm-muted adm-measure">
          Sign in to reach your sessions, scheduled recordings and the plugin registry.
        </p>
      }
    >
      {locked ? (
        <ErrorPanel title={RATE_LIMIT_TITLE} body={`Retry in ${remainingSeconds}s`} />
      ) : unreachable ? (
        <ErrorPanel
          title={UNREACHABLE}
          actions={
            <Button variant="secondary" onClick={() => void submit()}>
              Retry
            </Button>
          }
        />
      ) : formError !== null ? (
        <ErrorPanel title={formError} />
      ) : null}
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <Input
          label="Username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          error={fieldErrors.username}
          autoComplete="username"
          enterKeyHint="next"
          required
          disabled={disabled}
        />
        <Input
          label="Password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={passwordError ?? fieldErrors.password}
          autoComplete="current-password"
          enterKeyHint="go"
          required
          disabled={disabled}
        />
        <Button type="submit" variant="primary" className="auth-submit" loading={submitting} disabled={disabled}>
          Sign in
        </Button>
      </form>
    </AuthFrame>
  )
}
