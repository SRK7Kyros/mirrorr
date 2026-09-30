import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { useState } from "react"
import type { FormEvent } from "react"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { useToast } from "@/components/ui/Toast"
import { useAuthStatus } from "@/hooks/use-auth-status"
import { useRateLimitLock } from "@/hooks/use-rate-limit-lock"
import { ApiError } from "@/lib/api"
import { login } from "@/lib/auth"

const INVALID_CREDENTIALS = "Invalid username or password"
const API_UNREACHABLE = "API unreachable"
const UNEXPECTED_RESPONSE = "Unexpected server response"
const RATE_LIMITED_TITLE = "Too many attempts — try again shortly"
// string-typed: /register is intentionally not mounted in router.tsx yet (registerRoute export is reported for wiring).
const registerPath: string = "/register"

/**
 * V1 Login (spec §5): centred card on bg-base, inline 401 (never toast),
 * 429 → toast + 30s submit lockout with countdown, footer register link
 * only while `GET /auth/status` reports `has_users === false`.
 */
export function LoginView() {
  const navigate = useNavigate()
  const search = useSearch({ from: "/public/login" })
  const { toast } = useToast()
  const authStatus = useAuthStatus()
  const { locked, remainingSeconds, lock } = useRateLimitLock()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const busy = submitting || locked

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (busy) return
    setSubmitting(true)
    setError(null)
    try {
      await login(username, password)
      await navigate({ to: search.redirect ?? "/sessions" })
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setError(INVALID_CREDENTIALS)
        } else if (err.status === 429) {
          toast({ kind: "error", title: RATE_LIMITED_TITLE })
          lock()
        } else if (err.status === 0) {
          setError(API_UNREACHABLE)
        } else {
          setError(err.message)
        }
      } else {
        setError(UNEXPECTED_RESPONSE)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <h1 className="t-h3">Mirrorr</h1>
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <Input
            label="Username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            enterKeyHint="next"
            required
            disabled={submitting}
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            enterKeyHint="go"
            required
            disabled={submitting}
          />
          <Button
            type="submit"
            variant="primary"
            className="auth-submit"
            loading={submitting}
            disabled={busy}
          >
            {locked ? `Sign in — retry in ${remainingSeconds}s` : "Sign in"}
          </Button>
        </form>
        {error !== null ? (
          <p className="auth-error" role="alert">
            {error}
          </p>
        ) : null}
        {authStatus.status?.has_users === false ? (
          <p className="auth-hint">
            No accounts yet? <Link to={registerPath}>Create the first admin account</Link>
          </p>
        ) : null}
      </div>
    </main>
  )
}
