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
            {pending ? (
              <div className="flex flex-col gap-4">
                <Banner kind="info" title="Registration submitted">
                  An administrator must approve <strong>{username.trim()}</strong> before you can sign in.
                </Banner>
                <Link className={buttonClass({ variant: "secondary", block: true })} to="/login">
                  Back to sign in
                </Link>
              </div>
            ) : (
              <form className="flex flex-col gap-4" onSubmit={(event) => void onSubmit(event)} noValidate>
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
        <div className="flex justify-center gap-2 text-sm text-ink-muted">
          <span>{authStatus.status?.has_users === false ? "Already set up?" : "Have an account?"}</span>
          <Link to="/login">Sign in</Link>
        </div>
      </div>
    </div>
  )
}
