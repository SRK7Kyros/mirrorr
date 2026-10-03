import { Navigate, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import type { FormEvent } from "react"
import { Button } from "@/components/ui/Button"
import { ErrorPanel } from "@/components/ui/ErrorPanel"
import { Input } from "@/components/ui/Input"
import { useToast } from "@/components/ui/Toast"
import { useAuthStatus } from "@/hooks/use-auth-status"
import { useRateLimitLock } from "@/hooks/use-rate-limit-lock"
import { ApiError } from "@/lib/api"
import { register } from "@/lib/auth"
import { AuthFrame, AuthSplash, RATE_LIMIT_TITLE, REGISTER_LOCK_MS } from "./auth-frame"
import "@/styles/views-admin.css"

const NAME_TAKEN = "A resource with that name already exists."
const UNREACHABLE = "Cannot reach the recorder — retry"
const UNEXPECTED = "Unexpected server response"

/**
 * §5.2 Auth — Register. Bootstrap (no users) owns "Create first admin account";
 * an admin-initiated mount flips the label to "Create user". Handles the
 * approval-gated `{status:"pending"}` response, 400 duplicate name inline on
 * the username, 403 non-admin, 422 `loc` mapping and the 5/60s 429 lock.
 */
export function RegisterView() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const authStatus = useAuthStatus()
  const { locked, remainingSeconds, lock } = useRateLimitLock(REGISTER_LOCK_MS)
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [unreachable, setUnreachable] = useState(false)
  const [notAdmin, setNotAdmin] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const bootstrap = authStatus.status?.has_users === false

  if (authStatus.isLoading) return <AuthSplash title="Create an account" />
  if (!bootstrap) return <Navigate to="/login" />

  const submit = async (): Promise<void> => {
    if (submitting || locked) return
    setSubmitting(true)
    setFieldErrors({})
    setFormError(null)
    setUnreachable(false)
    setNotAdmin(false)
    setPending(null)
    try {
      const result = await register(username, password, displayName)
      if ("status" in result) {
        setPending(typeof result.username === "string" ? result.username : username)
        return
      }
      await navigate({ to: "/sessions" })
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 400) setFieldErrors({ username: error.message === "" ? NAME_TAKEN : error.message })
        else if (error.status === 403) setNotAdmin(true)
        else if (error.status === 429) {
          toast({ kind: "error", title: RATE_LIMIT_TITLE })
          lock()
        } else if (error.status === 0 || error.status >= 500) setUnreachable(true)
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
      title={bootstrap ? "Create the first admin account" : "Create an account"}
      footnote={
        bootstrap ? (
          <p className="t-body adm-muted adm-measure">
            This first account becomes the administrator.
          </p>
        ) : undefined
      }
    >
      {pending !== null ? (
        <div className="adm-notice" role="status">
          <span className="adm-banner__title">Registration pending approval</span>
          <p className="t-body adm-measure">
            {`'${pending}' was submitted. An administrator must approve it before it can sign in.`}
          </p>
          <div className="adm-row">
            <Button variant="secondary" onClick={() => void navigate({ to: "/login" })}>
              Return to sign in
            </Button>
          </div>
        </div>
      ) : null}
      {notAdmin ? (
        <ErrorPanel
          title="Not admin"
          body="Only an administrator can create accounts."
          actions={
            <Button variant="secondary" onClick={() => void navigate({ to: "/sessions" })}>
              Back to the app
            </Button>
          }
        />
      ) : null}
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
          error={fieldErrors.password}
          autoComplete="new-password"
          enterKeyHint="next"
          required
          disabled={disabled}
        />
        <Input
          label="Display name"
          helper="Shown in the users list."
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          error={fieldErrors.display_name}
          autoComplete="nickname"
          enterKeyHint="go"
          disabled={disabled}
        />
        <Button type="submit" variant="primary" className="auth-submit" loading={submitting} disabled={disabled}>
          {bootstrap ? "Create first admin account" : "Create user"}
        </Button>
      </form>
    </AuthFrame>
  )
}
