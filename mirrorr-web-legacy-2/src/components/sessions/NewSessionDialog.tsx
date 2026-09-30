/**
 * D1 — the new-session dialog.
 *
 * Contract: `docs/web-frontend-spec.md` L399-L401 and the endpoint matrix
 * L426-L433 (`POST /sessions/` only; there is no "run" endpoint). The form
 * prefills from a profile, tracks edits per field, and submits either the
 * profile-only or the full explicit body through `buildSessionRequest`
 * (`src/lib/new-session-form.ts`). A `can_record:false` engine keeps the
 * recording switch visible but disabled with the "Engine cannot record"
 * tooltip (spec L400/L217).
 */
import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { DynamicSchemaForm } from "@/components/forms/DynamicSchemaForm"
import { Button } from "@/components/ui/Button"
import { Dialog } from "@/components/ui/Dialog"
import { Select } from "@/components/ui/Select"
import { Switch } from "@/components/ui/Switch"
import { entityStore } from "@/lib/entity-store-client"
import { ApiError, userMessageForError } from "@/lib/errors"
import {
  applyEngine,
  applyProfile,
  applyResolver,
  applyRetryMode,
  buildSessionRequest,
  createEmptySessionForm,
  markSessionFormDirty,
  retryModeOptions,
  sessionFormErrors,
  type SessionFormField,
  type SessionFormState,
} from "@/lib/new-session-form"
import { createEntity } from "@/lib/optimistic-policy"
import { QUERY_STALE_TIMES_MS, queryKeys } from "@/lib/query-keys"
import { engineCanRecord, type Profile } from "@/lib/schemas/plugins"
import { createSession, fetchAllEngines, fetchAllProfiles, fetchAllResolvers } from "@/lib/sessions-api"
import { showToast } from "@/lib/toast"

export interface NewSessionDialogProps {
  readonly open: boolean
  readonly onClose: () => void
  /** V8's "Use" profile prefill; `null`/absent starts from an empty form. */
  readonly prefillProfile?: Profile | null
}

export function NewSessionDialog({ open, onClose, prefillProfile = null }: NewSessionDialogProps) {
  const [form, setForm] = useState<SessionFormState>(createEmptySessionForm)
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({})
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm(prefillProfile === null ? createEmptySessionForm() : applyProfile(createEmptySessionForm(), prefillProfile))
    setErrors({})
    setSubmitting(false)
  }, [open, prefillProfile])

  const enginesQuery = useQuery({
    queryKey: queryKeys.engines(),
    queryFn: ({ signal }) => fetchAllEngines(signal),
    staleTime: QUERY_STALE_TIMES_MS.engines,
    enabled: open,
  })
  const resolversQuery = useQuery({
    queryKey: queryKeys.resolvers(),
    queryFn: ({ signal }) => fetchAllResolvers(signal),
    staleTime: QUERY_STALE_TIMES_MS.resolvers,
    enabled: open,
  })
  const profilesQuery = useQuery({
    queryKey: queryKeys.profilesCatalog(),
    queryFn: ({ signal }) => fetchAllProfiles(signal),
    staleTime: QUERY_STALE_TIMES_MS.profiles,
    enabled: open,
  })

  const engines = enginesQuery.data ?? []
  const resolvers = resolversQuery.data ?? []
  const profiles = profilesQuery.data ?? []

  const engine = useMemo(() => engines.find((item) => item.id === form.engineId) ?? null, [engines, form.engineId])
  const resolver = useMemo(
    () => resolvers.find((item) => item.id === form.resolverId) ?? null,
    [resolvers, form.resolverId],
  )
  const retrySchema = engine?.retry_modes_schema?.[form.retryMode]?.schema
  const recordable = engine === null || engineCanRecord(engine)

  function edit(next: SessionFormState, ...fields: readonly SessionFormField[]) {
    setForm(markSessionFormDirty(next, ...fields))
  }

  async function handleSubmit() {
    const nextErrors = sessionFormErrors(form, resolver)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setSubmitting(true)
    try {
      const created = await createEntity(entityStore, {
        resource: "session",
        mutate: () => createSession(buildSessionRequest(form)),
      })
      showToast(`Session #${created.id} started`, "info")
      onClose()
      // The session detail route lands with todo 13; navigation is the spec
      // target (`/sessions/{id}`) and the list will show the new row.
      window.location.assign(`/sessions/${created.id}`)
    } catch (error) {
      const fieldErrors = error instanceof ApiError ? error.fieldErrors : undefined
      if (fieldErrors !== undefined && Object.keys(fieldErrors).length > 0) {
        setErrors(fieldErrors)
      } else {
        showToast(userMessageForError(error))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New session"
      size="wizard"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={submitting}>
            Start session
          </Button>
        </>
      }
    >
      <div data-testid="new-session-form" className="flex flex-col gap-4">
        <div className="flex items-center gap-2" role="group" aria-label="Configuration source">
          <Button
            variant={form.source === "profile" ? "primary" : "secondary"}
            aria-pressed={form.source === "profile"}
            onClick={() => setForm((prev) => ({ ...prev, source: "profile" }))}
          >
            From profile
          </Button>
          <Button
            data-testid="source-custom"
            variant={form.source === "custom" ? "primary" : "secondary"}
            aria-pressed={form.source === "custom"}
            onClick={() => setForm((prev) => ({ ...prev, source: "custom" }))}
          >
            Custom
          </Button>
        </div>

        {form.source === "profile" ? (
          <Select
            label="Profile"
            value={form.profileId === null ? "" : String(form.profileId)}
            disabled={profiles.length === 0}
            onChange={(event) => {
              const selected = profiles.find((item) => String(item.id) === event.target.value)
              if (selected !== undefined) setForm((prev) => applyProfile(prev, selected))
            }}
          >
            {profiles.length === 0 ? <option value="">No profiles</option> : <option value="">Select…</option>}
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </Select>
        ) : null}

        <Select
          label="Engine"
          value={form.engineId === null ? "" : String(form.engineId)}
          error={errors.engine_id}
          onChange={(event) => {
            const selected = engines.find((item) => String(item.id) === event.target.value) ?? null
            edit(applyEngine(form, selected), "engine")
          }}
        >
          <option value="">Select…</option>
          {engines.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>

        <Select
          label="Resolver"
          value={form.resolverId === null ? "" : String(form.resolverId)}
          error={errors.resolver_id}
          onChange={(event) => {
            const selected = resolvers.find((item) => String(item.id) === event.target.value) ?? null
            edit(applyResolver(form, selected), "resolver")
          }}
        >
          <option value="">Select…</option>
          {resolvers.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>

        {resolver !== null ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-label font-medium text-text-primary">Resolver configuration</h3>
            <DynamicSchemaForm
              schema={resolver.config_schema}
              values={form.resolverConfig}
              errors={errors}
              path="resolver_config"
              idPrefix="resolver-config"
              onChange={(next) => setForm(markSessionFormDirty({ ...form, resolverConfig: next }, "resolver_config"))}
            />
          </section>
        ) : null}

        <Select
          label="Retry mode"
          value={form.retryMode}
          onChange={(event) => edit(applyRetryMode(form, engine, event.target.value), "retry_mode")}
        >
          {retryModeOptions(engine).map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </Select>

        {retrySchema !== undefined ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-label font-medium text-text-primary">Retry configuration</h3>
            <DynamicSchemaForm
              schema={retrySchema}
              values={form.retryConfig}
              errors={errors}
              path="retry_config"
              idPrefix="retry-config"
              onChange={(next) => setForm(markSessionFormDirty({ ...form, retryConfig: next }, "retry_config"))}
            />
          </section>
        ) : null}

        <Switch
          label="Recording"
          checked={form.recording}
          disabled={!recordable}
          disabledReason="Engine cannot record"
          onCheckedChange={(checked) => setForm(markSessionFormDirty({ ...form, recording: checked }, "recording"))}
        />
      </div>
    </Dialog>
  )
}
