import { useEffect, useRef, useState, type FormEvent } from "react"
import { useNavigate } from "@tanstack/react-router"
import { getErrorMessage, login } from "@/api"
import { ApiError } from "@/api/client"
import { useAuthStatus } from "@/api/hooks"
import { isNativeShell, readHostCredential } from "@/api/native"
import { Button, Field, Input, PasswordInput, Skeleton } from "@/ui/components"
import { useCapsLock } from "@/ui/hooks"
import { landAfterAuth } from "./landing"
import { AuthError, AuthLink, AuthShell } from "./auth-shell"

export function LoginView() {
  const navigate = useNavigate()
  const authStatus = useAuthStatus()
  const capsLock = useCapsLock()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({})
  const [busy, setBusy] = useState(false)
  const [autoUsername, setAutoUsername] = useState<string | null>(null)
  const autoLoginTried = useRef(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    setFieldErrors({})
    try {
      const auth = await login(username.trim(), password)
      await landAfterAuth(auth.user?.role, (to) => navigate({ to }))
    } catch (caught) {
      if (caught instanceof ApiError && caught.fieldErrors !== undefined) setFieldErrors(caught.fieldErrors)
      setError(getErrorMessage(caught, "Sign-in failed"))
    } finally {
      setBusy(false)
    }
  }

  // The phone app's server picker can hold this host's credentials, so the
  // console signs itself in instead of asking again. Once per page load: a
  // rejected credential falls back to the form rather than retrying.
  useEffect(() => {
    if (autoLoginTried.current || !isNativeShell()) return
    autoLoginTried.current = true
    void (async () => {
      const credential = await readHostCredential(window.location.origin)
      if (credential === null) return
      setAutoUsername(credential.username)
      try {
        const auth = await login(credential.username, credential.password)
        await landAfterAuth(auth.user?.role, (to) => navigate({ to }))
      } catch {
        setAutoUsername(null)
        setError("Saved credentials were rejected — sign in below.")
      }
    })()
  }, [navigate])

  // `/auth/status` decides whether the second door creates the first admin or
  // files a request. Rendering a label before it resolves makes the link flip
  // under the pointer, so the footer keeps its space and stays silent until the
  // answer is in.
  const statusKnown = authStatus.isLoading !== true && authStatus.status !== undefined
  const isFirstUser = authStatus.status?.has_users === false

  return (
    <AuthShell
      footer={
        statusKnown ? (
          <>
            <span>{isFirstUser ? "No account yet?" : "Need an account?"}</span>
            <AuthLink to="/register">{isFirstUser ? "Create the first user" : "Request access"}</AuthLink>
            <span className="px-2 text-sm text-dim">Forgotten it? An administrator can reset it.</span>
          </>
        ) : (
          <Skeleton width={220} height={16} />
        )
      }
    >
      {autoUsername !== null ? (
        <p className="text-base text-ink-muted">
          Signing in as <strong className="text-ink">{autoUsername}</strong>…
        </p>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(event) => void onSubmit(event)} noValidate>
          <AuthError message={error} />
          <Field label="Username" htmlFor="login-username" required error={fieldErrors.username ?? null}>
            <Input
              id="login-username"
              name="username"
              className="h-11"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </Field>
          <Field
            label="Password"
            htmlFor="login-password"
            required
            error={fieldErrors.password ?? null}
            hint={capsLock ? "Caps Lock is on." : undefined}
          >
            <PasswordInput
              id="login-password"
              name="password"
              className="h-11"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Button
            type="submit"
            variant="primary"
            block
            className="min-h-11"
            loading={busy}
            disabled={username.trim() === "" || password === ""}
          >
            Sign in
          </Button>
        </form>
      )}
    </AuthShell>
  )
}
