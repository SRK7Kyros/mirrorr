import { Navigate, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import type { FormEvent } from "react"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Spinner } from "@/components/ui/Spinner"
import { useToast } from "@/components/ui/Toast"
import { useAuthStatus } from "@/hooks/use-auth-status"
import { useRateLimitLock } from "@/hooks/use-rate-limit-lock"
import { ApiError } from "@/lib/api"
import { register } from "@/lib/auth"

const PASSWORDS_MISMATCH = "Passwords do not match"
const API_UNREACHABLE = "API unreachable"
const UNEXPECTED_RESPONSE = "Unexpected server response"
const RATE_LIMITED_TITLE = "Too many attempts — try again shortly"
const PENDING_APPROVAL = "Registration pending approval"

/**
 * V2 Register (spec §5): same card geometry as V1; full-page spinner while
 * `GET /auth/status` loads; any result other than `has_users === false`
 * redirects to /login; 422 → per-field Input errors; success → /sessions.
 */
export function RegisterView() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const authStatus = useAuthStatus()
  const { locked, remainingSeconds, lock } = useRateLimitLock()
  const [username, setUsername] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (authStatus.isLoading) {
    return (
      <div className="auth-status">
        <Spinner size="lg" label="Loading" />
      </div>
    )
  }

  // Bootstrap only: unknown status (429/network) or existing users → login.
  if (authStatus.status?.has_users !== false) {
    return <Navigate to="/login" />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (submitting || locked) return
    if (password !== confirmPassword) {
      setFieldErrors({ confirm_password: PASSWORDS_MISMATCH })
      setFormError(null)
      return
    }
    setSubmitting(true)
    setFieldErrors({})
    setFormError(null)
    try {
      const result = await register(username, password, displayName)
      if ("status" in result) {
        setFormError(PENDING_APPROVAL)
        return
      }
      await navigate({ to: "/sessions" })
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 422 && err.fieldErrors !== undefined) {
          const { _form, ...rest } = err.fieldErrors
          setFieldErrors(rest)
          if (_form !== undefined) setFormError(_form)
        } else if (err.status === 429) {
          toast({ kind: "error", title: RATE_LIMITED_TITLE })
          lock()
        } else if (err.status === 0) {
          setFormError(API_UNREACHABLE)
        } else {
          setFormError(err.message)
        }
      } else {
        setFormError(UNEXPECTED_RESPONSE)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <h1 className="t-h2">Create the first admin account</h1>
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <Input
            label="Username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            error={fieldErrors.username}
            autoComplete="username"
            enterKeyHint="next"
            required
            disabled={submitting}
          />
          <Input
            label="Display name (optional)"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            error={fieldErrors.display_name}
            autoComplete="nickname"
            disabled={submitting}
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={fieldErrors.password}
            autoComplete="new-password"
            enterKeyHint="next"
            required
            disabled={submitting}
          />
          <Input
            label="Confirm password"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            error={fieldErrors.confirm_password}
            autoComplete="new-password"
            enterKeyHint="go"
            required
            disabled={submitting}
          />
          <p className="auth-hint">This first account becomes the administrator</p>
          <Button
            type="submit"
            variant="primary"
            className="auth-submit"
            loading={submitting}
            disabled={submitting || locked}
          >
            {locked
              ? `Create admin account — retry in ${remainingSeconds}s`
              : "Create admin account"}
          </Button>
        </form>
        {formError !== null ? (
          <p className="auth-error" role="alert">
            {formError}
          </p>
        ) : null}
      </div>
    </main>
  )
}
