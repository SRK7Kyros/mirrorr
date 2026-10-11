import { useState, type FormEvent } from "react"
import { Link, useNavigate } from "@tanstack/react-router"
import { getErrorMessage, register } from "@/api"
import { ApiError } from "@/api/client"
import { useAuthStatus } from "@/api/hooks"
import { Banner, Button, buttonClass, Field, IconDisc, Input, Panel, PanelBody } from "@/ui/components"

export function RegisterView() {
  const navigate = useNavigate()
  const authStatus = useAuthStatus()
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
      await navigate({ to: "/sessions" })
    } catch (caught) {
      if (caught instanceof ApiError && caught.fieldErrors !== undefined) setFieldErrors(caught.fieldErrors)
      setError(getErrorMessage(caught, "Registration failed"))
    } finally {
      setBusy(false)
    }
  }

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
            {pending ? (
              <div className="stack">
                <Banner kind="info" title="Registration submitted">
                  An administrator must approve <strong>{username.trim()}</strong> before you can sign in.
                </Banner>
                <Link className={buttonClass({ variant: "secondary", block: true })} to="/login">
                  Back to sign in
                </Link>
              </div>
            ) : (
              <form className="stack" onSubmit={(event) => void onSubmit(event)} noValidate>
                {error !== null ? <Banner kind="danger" title={error} /> : null}
                <Field label="Username" htmlFor="register-username" required error={fieldErrors.username ?? null}>
                  <Input
                    id="register-username"
                    name="username"
                    autoComplete="username"
                    autoFocus
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                  />
                </Field>
                <Field label="Display name" htmlFor="register-display-name" hint="Shown in the sidebar and lists.">
                  <Input
                    id="register-display-name"
                    name="display_name"
                    autoComplete="name"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                </Field>
                <Field label="Password" htmlFor="register-password" required error={fieldErrors.password ?? null}>
                  <Input
                    id="register-password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </Field>
                <Field label="Confirm password" htmlFor="register-confirm" required>
                  <Input
                    id="register-confirm"
                    name="confirm"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                  />
                </Field>
                <Button
                  type="submit"
                  variant="primary"
                  block
                  loading={busy}
                  disabled={username.trim() === "" || password === "" || confirm === ""}
                >
                  Create account
                </Button>
              </form>
            )}
          </PanelBody>
        </Panel>
        <div className="auth-links">
          <span>{authStatus.status?.has_users === false ? "Already set up?" : "Have an account?"}</span>
          <Link to="/login">Sign in</Link>
        </div>
      </div>
    </div>
  )
}
