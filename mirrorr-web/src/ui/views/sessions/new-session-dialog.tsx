import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createSession, getErrorMessage, useEngines, useProfiles, useResolvers, type SessionCreateBody } from "@/api"
import { queryRoots } from "@/api/query-keys"
import {
  Banner,
  Button,
  Dialog,
  Field,
  SchemaForm,
  Segmented,
  Select,
  Switch,
  defaultsFromSchema,
  toast,
} from "@/ui/components"
import { SourcePicker } from "@/ui/views/shared/source-picker"

export function NewSessionDialog({
  open,
  onClose,
}: {
  readonly open: boolean
  readonly onClose: () => void
}) {
  const queryClient = useQueryClient()
  const profiles = useProfiles()
  const engines = useEngines()
  const resolvers = useResolvers()

  const [mode, setMode] = useState<"profile" | "custom">("profile")
  const [profileId, setProfileId] = useState("")
  const [engineId, setEngineId] = useState("")
  const [resolverId, setResolverId] = useState("")
  const [resolverConfig, setResolverConfig] = useState<Record<string, unknown>>({})
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setMode(profiles.length > 0 ? "profile" : "custom")
    setEngineId("")
    setResolverId("")
    setResolverConfig({})
    setRecording(false)
  }, [open, profiles.length])

  const create = useMutation({
    mutationFn: (body: SessionCreateBody) => createSession(body),
    onSuccess: (session) => {
      toast.success("Session started", `#${session.id}`)
      void queryClient.invalidateQueries({ queryKey: queryRoots.sessions })
      onClose()
    },
    onError: (caught) => setError(getErrorMessage(caught, "Could not start the session")),
  })

  const resolver = resolvers.find((item) => String(item.id) === resolverId)
  const canSubmit = mode === "profile" ? profileId !== "" : engineId !== "" && resolverId !== ""

  function changeResolver(nextId: string): void {
    setResolverId(nextId)
    setResolverConfig(defaultsFromSchema(resolvers.find((item) => String(item.id) === nextId)?.config_schema))
  }

  const submit = () => {
    setError(null)
    const body: SessionCreateBody =
      mode === "profile"
        ? { profile_id: Number(profileId), recording }
        : { engine_id: Number(engineId), resolver_id: Number(resolverId), resolver_config: resolverConfig, recording }
    create.mutate(body)
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New session"
      description="Start a capture now. A profile carries its own engine, resolver and retry policy."
      busy={create.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button variant="primary" loading={create.isPending} disabled={!canSubmit} onClick={submit}>
            Start session
          </Button>
        </>
      }
    >
      <div className="stack">
        {error !== null ? <Banner kind="danger" title={error} /> : null}

        <Field label="Source">
          <Segmented
            ariaLabel="Session source"
            active={mode}
            onChange={setMode}
            items={[
              { id: "profile", label: "Use a profile", disabled: profiles.length === 0 },
              { id: "custom", label: "Pick engine + resolver" },
            ]}
          />
        </Field>

        {mode === "profile" ? (
          <Field label="Profile" htmlFor="new-session-profile" required hint={`${profiles.length} available`}>
            <Select id="new-session-profile" value={profileId} onChange={(event) => setProfileId(event.target.value)}>
              <option value="">Select a profile…</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={String(profile.id)}>
                  {profile.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <>
            <Field label="Engine" htmlFor="new-session-engine" required>
              <Select id="new-session-engine" value={engineId} onChange={(event) => setEngineId(event.target.value)}>
                <option value="">Select an engine…</option>
                {engines.map((engine) => (
                  <option key={engine.id} value={String(engine.id)}>
                    {engine.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Resolver" htmlFor="new-session-resolver" required>
              <Select
                id="new-session-resolver"
                value={resolverId}
                onChange={(event) => changeResolver(event.target.value)}
              >
                <option value="">Select a resolver…</option>
                {resolvers.map((item) => (
                  <option key={item.id} value={String(item.id)}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </Field>
            <SourcePicker
              idPrefix="new-session"
              resolverId={resolverId}
              onPick={(source) => {
                setResolverId(String(source.resolver_id))
                setResolverConfig(source.resolver_config ?? {})
              }}
            />
            {resolver === undefined ? null : (
              <section className="stack-sm">
                <h3 className="panel-title">Resolver config</h3>
                <SchemaForm
                  schema={resolver.config_schema}
                  value={resolverConfig}
                  onChange={setResolverConfig}
                  idPrefix="new-session-resolver-config"
                />
              </section>
            )}
          </>
        )}

        <Switch
          label="Record this session"
          checked={recording}
          onChange={(event) => setRecording(event.target.checked)}
        />
      </div>
    </Dialog>
  )
}
