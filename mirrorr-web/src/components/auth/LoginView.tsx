import { Link, useNavigate } from "@tanstack/react-router"
import { Loader2 } from "lucide-react"
import { useEffect, useState, type FormEvent } from "react"
import { AuthCard } from "@/components/auth/AuthCard"
import { AuthField } from "@/components/auth/AuthField"
import { useAuthStatus } from "@/hooks/use-auth-status"
import { useRateLimitLockout } from "@/hooks/use-rate-limit-lockout"
import { login } from "@/lib/auth"
import { postLoginPath } from "@/lib/auth-redirect"
import {
  API_UNREACHABLE_MESSAGE,
  LOGIN_FAILED_MESSAGE,
  RATE_LIMITED_MESSAGE,
  completeAuthentication,
} from "@/lib/auth-store"
import { ApiError } from "@/lib/errors"
import { showToast } from "@/lib/toast"

interface LoginViewProps {
  readonly redirectPath: string | null
}

/** V1 Login (spec L231-L250). */
export function LoginView({ redirectPath }: LoginViewProps) {
  const navigate = useNavigate()
  const { hasUsers, rateLimited } = useAuthStatus()
  const { isLocked, lock } = useRateLimitLockout()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (rateLimited) lock()
  }, [rateLimited, lock])

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (isSubmitting || isLocked) return

    setErrorMessage(null)
    setIsSubmitting(true)

    try {
      const response = await login({ username, password })
      completeAuthentication(response)
      await navigate({ href: postLoginPath(redirectPath) })
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setErrorMessage(LOGIN_FAILED_MESSAGE)
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
    <AuthCard title="Mirrorr">
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3" data-testid="login-form">
        <AuthField
          id="login-username"
          label="Username"
          value={username}
          onChange={setUsername}
          autoComplete="username"
          enterKeyHint="next"
        />
        <AuthField
          id="login-password"
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          enterKeyHint="go"
        />
        <button
          type="submit"
          disabled={submitDisabled}
          aria-busy={isSubmitting}
          className="flex h-8 items-center justify-center gap-1.5 rounded-control bg-accent px-3 text-body font-medium text-bg-base transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {isSubmitting ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : null}
          Sign in
        </button>
        {errorMessage === null ? null : (
          <p data-testid="login-error" role="alert" className="text-small text-danger">
            {errorMessage}
          </p>
        )}
      </form>
      {hasUsers === false ? (
        <p className="text-small text-text-secondary">
          No accounts yet?{" "}
          <Link to="/register" className="text-accent hover:text-accent-hover">
            Create the first admin account
          </Link>
        </p>
      ) : null}
    </AuthCard>
  )
}
