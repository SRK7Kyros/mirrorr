/**
 * D2 — the four-step autorun wizard.
 *
 * Contract: `docs/web-frontend-spec.md` L402 + `docs/general-client-specification.md`
 * §13.11.1–§13.11.2. Steps: 1 Identity (auto-slugged `snake_case_name` with a
 * manual override and the live regex), 2 Schedule (naive-UTC `datetime-local`
 * pickers, end>start validation, past-start warning), 3 Configuration (D1's
 * widgets), 4 Review. Create mode submits the short `profile_id` body until a
 * config field is edited, then the full explicit body; edit mode PUTs only
 * dirty fields. While the autorun is live, the config fields and the start time
 * are disabled and the banner explains that an end time in the past stops the
 * current run.
 */
import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { DynamicSchemaForm } from "@/components/forms/DynamicSchemaForm"
import { Button } from "@/components/ui/Button"
import { Dialog } from "@/components/ui/Dialog"
import { Input } from "@/components/ui/Input"
import { Select } from "@/components/ui/Select"
import { Switch } from "@/components/ui/Switch"
import {
  AUTORUN_LIVE_END_WARNING,
  AUTORUN_LIVE_LOCK_MESSAGE,
  applyAutorunEngine,
  applyAutorunProfile,
  applyAutorunResolver,
  applyAutorunRetryMode,
  autorunFormErrors,
  autorunFormFromAutorun,
  autorunTimeWarning,
  buildAutorunCreateBody,
  buildAutorunUpdateBody,
  createEmptyAutorunForm,
  isAutorunLiveStatus,
  markAutorunFormDirty,
  retryModeOptions,
  withAutorunEnd,
  withAutorunName,
  withAutorunRecording,
  withAutorunSlug,
  withAutorunStart,
  type AutorunFormMode,
  type AutorunFormState,
} from "@/lib/autorun-form"
import { createAutorun, updateAutorun } from "@/lib/autoruns-api"
import type { EntityStore } from "@/lib/entity-store"
import { entityStore } from "@/lib/entity-store-client"
import { ApiError, userMessageForError } from "@/lib/errors"
import { createEntity } from "@/lib/optimistic-policy"
import { QUERY_STALE_TIMES_MS, queryKeys } from "@/lib/query-keys"
import { queryClient } from "@/query-client"
import type { Autorun } from "@/lib/schemas/autoruns"
import { readJsonSchema } from "@/lib/schemas/json-schema"
import { engineCanRecord } from "@/lib/schemas/plugins"
import { fetchAllEngines, fetchAllProfiles, fetchAllResolvers } from "@/lib/sessions-api"
import { TIME_MESSAGES } from "@/lib/time"
import { showToast } from "@/lib/toast"

export type AutorunWizardStep = 1 | 2 | 3 | 4

export const AUTORUN_STEPS = ["Identity", "Schedule", "Configuration", "Review"] as const

export interface AutorunWizardProps {
  readonly open: boolean
  readonly onClose: () => void
  /** Edit target; `null`/absent runs the create flow. */
  readonly autorun?: Autorun | null
  readonly store?: EntityStore
}

function pickErrors(errors: Readonly<Record<string, string>>, matches: (key: string) => boolean) {
  const picked: Record<string, string> = {}
  for (const [key, message] of Object.entries(errors)) if (matches(key)) picked[key] = message
  return picked
}

export function AutorunWizard({ open, onClose, autorun = null, store = entityStore }: AutorunWizardProps) {
  const editing = autorun
  const editingId = editing?.id ?? null
  const mode: AutorunFormMode = editing === null ? "create" : "edit"

  const [step, setStep] = useState<AutorunWizardStep>(1)
  const [form, setForm] = useState<AutorunFormState>(createEmptyAutorunForm)
  const [touchedSteps, setTouchedSteps] = useState<ReadonlySet<number>>(new Set())
  const [clock, setClock] = useState(() => new Date())
  const [serverErrors, setServerErrors] = useState<Readonly<Record<string, string>>>({})
  const [submitError, setSubmitError] = useState<string | undefined>(undefined)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setStep(1)
    setForm(editing === null ? createEmptyAutorunForm() : autorunFormFromAutorun(editing))
    setTouchedSteps(new Set())
    setClock(new Date())
    setServerErrors({})
    setSubmitError(undefined)
    setSubmitting(false)
    // `editing` is read at open time on purpose; the id keys the reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingId])

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
    queryKey: queryKeys.profiles(),
    queryFn: ({ signal }) => fetchAllProfiles(signal),
    staleTime: QUERY_STALE_TIMES_MS.profiles,
    enabled: open,
  })

  const selectedEngine = useMemo(
    () => enginesQuery.data?.find((engine) => engine.id === form.engineId) ?? null,
    [enginesQuery.data, form.engineId],
  )
  const selectedResolver = useMemo(
    () => resolversQuery.data?.find((resolver) => resolver.id === form.resolverId) ?? null,
    [resolversQuery.data, form.resolverId],
  )

  const liveLocked = editing !== null && isAutorunLiveStatus(editing.status)
  const allErrors = useMemo(
    () => ({
      ...autorunFormErrors(form, { resolver: selectedResolver, mode, locked: liveLocked, now: clock }),
      ...serverErrors,
    }),
    [form, selectedResolver, mode, liveLocked, clock, serverErrors],
  )

  const stepErrors = useMemo(() => {
    if (step === 1) return pickErrors(allErrors, (key) => key === "user_friendly_name" || key === "snake_case_name")
    if (step === 2) return pickErrors(allErrors, (key) => key === "start_time" || key === "end_time")
    if (step === 3)
      return pickErrors(
        allErrors,
        (key) => key === "engine_id" || key === "resolver_id" || key.startsWith("resolver_config") || key.startsWith("retry_config"),
      )
    return {}
  }, [allErrors, step])

  const shownErrors = touchedSteps.has(step) ? stepErrors : {}
  const timeWarning = form.startLocal !== "" ? autorunTimeWarning(form, clock) : null

  function goNext() {
    setTouchedSteps((previous) => new Set(previous).add(step))
    if (Object.keys(stepErrors).length > 0) return
    setStep((current) => (current < 4 ? ((current + 1) as AutorunWizardStep) : current))
  }

  function stepForErrorKey(key: string): AutorunWizardStep {
    if (key === "user_friendly_name" || key === "snake_case_name") return 1
    if (key === "start_time" || key === "end_time") return 2
    return 3
  }

  async function submit() {
    setTouchedSteps(new Set([1, 2, 3]))
    const firstErrorKey = Object.keys(allErrors)[0]
    if (firstErrorKey !== undefined) {
      setStep(stepForErrorKey(firstErrorKey))
      return
    }
    if (mode === "edit" && form.dirty.size === 0) return

    setSubmitting(true)
    setSubmitError(undefined)
    try {
      if (editing === null) {
        const created = await createEntity(store, {
          resource: "autorun",
          mutate: () => createAutorun(buildAutorunCreateBody(form)),
        })
        showToast(`Autorun "${created.user_friendly_name}" scheduled`, "info")
        onClose()
      } else {
        const updated = await updateAutorun(editing.id, buildAutorunUpdateBody(form, { locked: liveLocked }))
        store.applyAuthoritativeSnapshot("autorun", updated.id, { ...updated })
        await queryClient.invalidateQueries({ queryKey: queryKeys.autoruns(), type: "all" })
        showToast(`Autorun "${updated.user_friendly_name}" saved`, "info")
        onClose()
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.fieldErrors !== undefined && Object.keys(caught.fieldErrors).length > 0) {
        setServerErrors(caught.fieldErrors)
      }
      setSubmitError(userMessageForError(caught))
    } finally {
      setSubmitting(false)
    }
  }

  const engineOptions = enginesQuery.data ?? []
  const resolverOptions = resolversQuery.data ?? []
  const profileOptions = profilesQuery.data ?? []
  const retryConfigSchema = readJsonSchema(selectedEngine?.retry_modes_schema?.[form.retryMode]?.schema)
  const canRecord = engineCanRecord(selectedEngine)

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing === null ? "New autorun" : `Edit autorun #${editing.id}`}
      size="wizard"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          {step > 1 ? (
            <Button data-testid="autorun-back" variant="secondary" onClick={() => setStep((current) => (current - 1) as AutorunWizardStep)} disabled={submitting}>
              Back
            </Button>
          ) : null}
          {step < 4 ? (
            <Button data-testid="autorun-next" variant="primary" onClick={goNext}>
              Next
            </Button>
          ) : (
            <Button
              data-testid="autorun-submit"
              variant="primary"
              onClick={() => void submit()}
              disabled={submitting || (mode === "edit" && form.dirty.size === 0)}
            >
              {submitting ? "Saving…" : mode === "create" ? "Schedule autorun" : "Save changes"}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p data-testid="autorun-wizard-step" className="text-small text-text-muted">
          Step {step} of 4 — {AUTORUN_STEPS[step - 1]}
        </p>

        {liveLocked ? (
          <p data-testid="autorun-live-lock" role="status" className="rounded-control border border-warn px-3 py-2 text-small text-warn">
            {AUTORUN_LIVE_LOCK_MESSAGE}
          </p>
        ) : null}

        {step === 1 ? (
          <div className="flex flex-col gap-3">
            <Input
              label="Name"
              data-testid="autorun-name"
              value={form.userFriendlyName}
              error={shownErrors.user_friendly_name}
              autoComplete="off"
              onChange={(event) => setForm(withAutorunName(form, event.target.value))}
            />
            <Input
              label="Snake case name"
              data-testid="autorun-slug"
              value={form.snakeCaseName}
              error={shownErrors.snake_case_name}
              autoComplete="off"
              placeholder="auto_generated_from_name"
              onChange={(event) => setForm(withAutorunSlug(form, event.target.value))}
            />
          </div>
        ) : null}

        {step === 2 ? (
          <div className="flex flex-col gap-3">
            <Input
              label="Start"
              type="datetime-local"
              data-testid="autorun-start"
              value={form.startLocal}
              error={shownErrors.start_time}
              disabled={liveLocked}
              title={liveLocked ? "Start is frozen while live" : undefined}
              onChange={(event) => setForm(withAutorunStart(form, event.target.value))}
            />
            <Input
              label="End"
              type="datetime-local"
              data-testid="autorun-end"
              value={form.endLocal}
              error={shownErrors.end_time}
              onChange={(event) => setForm(withAutorunEnd(form, event.target.value))}
            />
            <p data-testid="autorun-utc-hint" className="text-small text-text-muted">
              {TIME_MESSAGES.localTimeHint}
            </p>
            {liveLocked ? (
              <p data-testid="autorun-live-end-warning" className="text-small text-warn">
                {AUTORUN_LIVE_END_WARNING}
              </p>
            ) : null}
            {timeWarning !== null ? (
              <p data-testid="autorun-past-warning" className="text-small text-warn">
                {timeWarning}
              </p>
            ) : null}
          </div>
        ) : null}

        {step === 3 ? (
          <fieldset disabled={liveLocked} className="flex flex-col gap-3 border-0 p-0">
            {mode === "create" ? (
              <Select
                label="Profile"
                data-testid="autorun-profile"
                value={form.source === "profile" && form.profileId !== null ? String(form.profileId) : ""}
                onChange={(event) => {
                  const profileId = Number(event.target.value)
                  const profile = profileOptions.find((item) => item.id === profileId)
                  setForm(profile === undefined ? markAutorunFormDirty({ ...form, source: "custom", profileId: null }, "profile") : applyAutorunProfile(form, profile))
                }}
              >
                <option value="">Custom configuration</option>
                {profileOptions.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </Select>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <Select
                label="Engine"
                data-testid="autorun-engine"
                value={form.engineId === null ? "" : String(form.engineId)}
                error={shownErrors.engine_id}
                onChange={(event) => {
                  const engineId = Number(event.target.value)
                  setForm(applyAutorunEngine(form, engineOptions.find((item) => item.id === engineId) ?? null))
                }}
              >
                <option value="">Select engine</option>
                {engineOptions.map((engine) => (
                  <option key={engine.id} value={engine.id}>
                    {engine.name}
                  </option>
                ))}
              </Select>
              <Select
                label="Resolver"
                data-testid="autorun-resolver"
                value={form.resolverId === null ? "" : String(form.resolverId)}
                error={shownErrors.resolver_id}
                onChange={(event) => {
                  const resolverId = Number(event.target.value)
                  setForm(applyAutorunResolver(form, resolverOptions.find((item) => item.id === resolverId) ?? null))
                }}
              >
                <option value="">Select resolver</option>
                {resolverOptions.map((resolver) => (
                  <option key={resolver.id} value={resolver.id}>
                    {resolver.name}
                  </option>
                ))}
              </Select>
            </div>

            <DynamicSchemaForm
              idPrefix="autorun-resolver-config"
              path="resolver_config"
              schema={selectedResolver?.config_schema}
              values={form.resolverConfig}
              errors={allErrors}
              onChange={(next) => setForm(markAutorunFormDirty({ ...form, resolverConfig: next }, "resolver_config"))}
            />

            <div className="grid grid-cols-2 gap-3">
              <Select
                label="Retry mode"
                data-testid="autorun-retry-mode"
                value={form.retryMode}
                onChange={(event) => setForm(applyAutorunRetryMode(form, selectedEngine, event.target.value))}
              >
                {retryModeOptions(selectedEngine).map((modeName) => (
                  <option key={modeName} value={modeName}>
                    {modeName}
                  </option>
                ))}
              </Select>
            </div>
            <DynamicSchemaForm
              idPrefix="autorun-retry-config"
              path="retry_config"
              schema={retryConfigSchema}
              values={form.retryConfig}
              errors={allErrors}
              onChange={(next) => setForm(markAutorunFormDirty({ ...form, retryConfig: next }, "retry_config"))}
            />

            <div data-testid="autorun-recording">
              <Switch
                label="Recording"
                checked={form.recording}
                disabled={!canRecord}
                disabledReason="Engine cannot record"
                onCheckedChange={(checked) => setForm(withAutorunRecording(form, checked))}
              />
            </div>
          </fieldset>
        ) : null}

        {step === 4 ? (
          <dl data-testid="autorun-review" className="grid grid-cols-2 gap-2 text-body">
            <dt className="text-text-muted">Name</dt>
            <dd>{form.userFriendlyName || "—"}</dd>
            <dt className="text-text-muted">Snake case</dt>
            <dd className="font-mono">{form.snakeCaseName || "—"}</dd>
            <dt className="text-text-muted">Start</dt>
            <dd>
              {form.startLocal || "—"} <span className="text-text-muted">({TIME_MESSAGES.localTimeHint})</span>
            </dd>
            <dt className="text-text-muted">End</dt>
            <dd>{form.endLocal || "—"}</dd>
            <dt className="text-text-muted">Engine → Resolver</dt>
            <dd>
              {selectedEngine?.name ?? (form.engineId === null ? "—" : `#${form.engineId}`)} →{" "}
              {selectedResolver?.name ?? (form.resolverId === null ? "—" : `#${form.resolverId}`)}
            </dd>
            <dt className="text-text-muted">Recording</dt>
            <dd>{form.recording ? "On" : "Off"}</dd>
            <dt className="text-text-muted">Kind</dt>
            <dd>One-off — not recurring</dd>
          </dl>
        ) : null}

        {submitError !== undefined ? (
          <p data-testid="autorun-submit-error" role="alert" className="text-small text-danger">
            {submitError}
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}
