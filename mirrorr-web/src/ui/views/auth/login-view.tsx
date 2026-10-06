import { useState, type FormEvent } from "react"
import { Link, useNavigate } from "@tanstack/react-router"
import { getErrorMessage, login } from "@/api"
import { ApiError } from "@/api/client"
import { useAuthStatus } from "@/api/hooks"
import { Banner, Button, Field, IconDisc, Input, Panel, PanelBody } from "@/ui/components"

export function LoginView() {
  const navigate = useNavigate()
  const authStatus = useAuthStatus()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({})
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    setFieldErrors({})
    try {
      await login(username.trim(), password)
      await navigate({ to: "/sessions" })
    } catch (caught) {
      if (caught instanceof ApiError && caught.fieldErrors !== undefined) setFieldErrors(caught.fieldErrors)
      setError(getErrorMessage(caught, "Sign-in failed"))
    } finally {
      setBusy(false)
    }
  }

  const showRegisterLink = !authStatus.isLoading && authStatus.status?.has_users === false

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark">
            <IconDisc size={18} />
          </span>
          <div>
            <div className="brand-name">Mirrorr</div>
            <div className="brand-sub">Control Room</div>
          </div>
        </div>
        <Panel>
          <PanelBody>
            <form className="stack" onSubmit={(event) => void onSubmit(event)} noValidate>
              {error !== null ? <Banner kind="danger" title={error} /> : null}
              <Field label="Username" htmlFor="login-username" required error={fieldErrors.username ?? null}>
                <Input
                  id="login-username"
                  name="username"
                  autoComplete="username"
                  autoFocus
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </Field>
              <Field label="Password" htmlFor="login-password" required error={fieldErrors.password ?? null}>
                <Input
                  id="login-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              <Button
                type="submit"
                variant="primary"
                block
                loading={busy}
                disabled={username.trim() === "" || password === ""}
              >
                Sign in
              </Button>
            </form>
          </PanelBody>
        </Panel>
        {showRegisterLink ? (
          <div className="auth-links">
            <span>No account yet?</span>
            <Link to="/register">Create the first user</Link>
          </div>
        ) : null}
      </div>
    </div>
  )
}
