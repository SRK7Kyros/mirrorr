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

  // No users yet → /register bootstraps the first admin; once users exist the
  // same page files a registration request an admin must approve. Either way it
  // is the only way in, so the link always renders and only the copy adapts.
  const isFirstUser = authStatus.status?.has_users === false

  return (
    <div className="grid place-items-center min-h-dvh px-4 pt-6 pb-6 bg-canvas">
      <div className="w-full max-w-[400px] flex flex-col gap-4">
        <div className="flex items-center justify-center gap-3 mb-2">
          <span className="grid place-content-center w-7 h-7 rounded-sm text-brand-ink shrink-0 [background:linear-gradient(140deg,var(--accent)_0%,var(--accent-press)_100%)]">
            <IconDisc size={18} />
          </span>
          <div>
            <div className="text-md font-bold tracking-[-0.02em]">Mirrorr</div>
            <div className="text-2xs text-ink-dim uppercase tracking-[0.08em] [font-family:var(--font-mono)]">Control Room</div>
          </div>
        </div>
        <Panel>
          <PanelBody>
            <form className="flex flex-col gap-4" onSubmit={(event) => void onSubmit(event)} noValidate>
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
        <div className="flex justify-center gap-2 text-sm text-ink-muted">
          <span>{isFirstUser ? "No account yet?" : "Need an account?"}</span>
          <Link to="/register">{isFirstUser ? "Create the first user" : "Request access"}</Link>
        </div>
      </div>
    </div>
  )
}
