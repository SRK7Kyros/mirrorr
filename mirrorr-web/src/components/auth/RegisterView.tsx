import { useNavigate } from "@tanstack/react-router"
import { Loader2 } from "lucide-react"
import { useEffect, useState, type FormEvent } from "react"
import { AuthCard } from "@/components/auth/AuthCard"
import { AuthField } from "@/components/auth/AuthField"
import { useAuthStatus } from "@/hooks/use-auth-status"
import { useRateLimitLockout } from "@/hooks/use-rate-limit-lockout"
import { register } from "@/lib/auth"
import {
  API_UNREACHABLE_MESSAGE,
  RATE_LIMITED_MESSAGE,
  completeAuthentication,
} from "@/lib/auth-store"
import { ApiError } from "@/lib/errors"
import { showToast } from "@/lib/toast"

const PASSWORD_MISMATCH_MESSAGE = "Passwords do not match"

/** V2 Register — first-user bootstrap (spec L252-L261). */
export function RegisterView() {
  const navigate = useNavigate()
  const { rateLimited } = useAuthStatus()
  const { isLocked, lock } = useRateLimitLockout()
  const [username, setUsername] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({})
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (rateLimited) lock()
  }, [rateLimited, lock])

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (isSubmitting || isLocked) return

    setErrorMessage(null)
    if (password !== confirmPassword) {
      setFieldErrors({ confirm_password: PASSWORD_MISMATCH_MESSAGE })
      return
    }
    setFieldErrors({})
    setIsSubmitting(true)

    try {
      const response = await register({
        username,
        password,
        displayName: displayName.trim(),
      })
      await completeAuthentication(response)
      await navigate({ href: "/sessions" })
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        setFieldErrors(error.fieldErrors ?? {})
      } else if (error instanceof ApiError && error.status === 429) {
        showToast(RATE_LIMITED_MESSAGE)
        lock()
      } else if (error instanceof ApiError) {
        setErrorMessage(error.detail)
      } else {
        setErrorMessage(API_UNREACHABLE_MESSAGE)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const submitDisabled = isSubmitting || isLocked

  return (
    <AuthCard title="Create the first admin account">
      <form
        onSubmit={handleSubmit}
        noValidate
        className="flex flex-col gap-3"
        data-testid="register-form"
      >
        <AuthField
          id="register-username"
          label="Username"
          value={username}
          onChange={setUsername}
          autoComplete="username"
          enterKeyHint="next"
          error={fieldErrors.username}
        />
        <AuthField
          id="register-display-name"
          label="Display name (optional)"
          value={displayName}
          onChange={setDisplayName}
          autoComplete="name"
          enterKeyHint="next"
          error={fieldErrors.display_name}
        />
        <AuthField
          id="register-password"
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          enterKeyHint="next"
          error={fieldErrors.password}
        />
        <AuthField
          id="register-confirm-password"
          label="Confirm password"
          type="password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          autoComplete="new-password"
          enterKeyHint="go"
          error={fieldErrors.confirm_password}
        />
        <button
          type="submit"
          disabled={submitDisabled}
          aria-busy={isSubmitting}
          className="flex h-8 items-center justify-center gap-1.5 rounded-control bg-accent px-3 text-body font-medium text-bg-base transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {isSubmitting ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : null}
          Create admin account
        </button>
        {errorMessage === null ? null : (
          <p data-testid="register-error" role="alert" className="text-small text-danger">
            {errorMessage}
          </p>
        )}
      </form>
      <p className="text-small text-text-secondary">
        This first account becomes the administrator
      </p>
    </AuthCard>
  )
}
