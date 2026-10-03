import { useMemo, useState } from "react"
import { Button } from "@/components/ui/Button"
import { Chip } from "@/components/ui/Chip"
import { Dialog } from "@/components/ui/Dialog"
import { Fieldset } from "@/components/ui/FormField"
import { Input } from "@/components/ui/Input"
import { Select } from "@/components/ui/Select"
import { useToast } from "@/components/ui/Toast"
import { ApiError } from "@/lib/api"
import type { Autorun, Profile } from "@/lib/schemas"
import { datetimeLocalToNaiveUtc, formatDateTime, naiveUtcToDatetimeLocal } from "@/lib/time"
import { createAutorun, updateAutorun, type AutorunBody } from "@/views/shared/api"
import { useEngines, useProfiles, useResolvers } from "@/views/shared/hooks"
import { diffDirtyFields, snapshotFields } from "@/views/shared/dirty"
import { prefillSchemaValues } from "@/components/ui/dynamic-schema-form"
import { ConfigFields, type ConfigFieldsValue, retrySchemaOf } from "@/views/shared/config-fields"
import { isLive } from "./filter-grammar"
import { configSnapshot, configSnapshotFrom } from "./autorun-shared"

export interface AutorunWizardDialogProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly editing?: Autorun | null
  readonly prefillProfileId?: number | null
}

const STEP_LABELS = ["Identity", "Schedule", "Config", "Review"] as const
const SLUG_RE = /^[a-zA-Z0-9_-]+$/
const CONFIG_KEYS = ["engine_id", "resolver_id", "resolver_config", "retry_mode", "retry_config"] as const

function autoSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function isConfigDirty(baseline: Record<string, unknown>, config: ConfigFieldsValue): boolean {
  const current = configSnapshotFrom(config)
  return CONFIG_KEYS.some((key) => JSON.stringify(baseline[key]) !== JSON.stringify(current[key]))
}

/** §11.23 — 422 `loc`-mapped copy, 400 duplicate-name, tz-suffixed times. */
function describeSubmitError(error: unknown): string {
  if (!(error instanceof ApiError)) return "Could not save the scheduled recording."
  if (error.status === 400) return "That snake-case name is already used on this server."
  if (error.status === 422) {
    const joined = Object.values(error.fieldErrors ?? {}).join(" ")
    if (joined.toLowerCase().includes("timezone") || joined.toLowerCase().includes("tz")) {
      return "Use the local-time picker — times are stored as UTC."
    }
    return joined === "" ? "Some fields need attention." : joined
  }
  return error.message
}

const EMPTY_CONFIG: ConfigFieldsValue = {
  engineId: null,
  resolverId: null,
  resolverConfig: {},
  retryMode: null,
  retryConfig: {},
  recording: true,
}

/**
 * §5.5 primary action — New scheduled recording (4 steps: Identity · Schedule ·
 * Config · Review). ONE-SHOT, so there are no weekday/cron controls. Local
 * `datetime-local` pickers convert to naive UTC on submit. Edit mode sends only
 * dirty fields (`PUT` exclude_unset semantics); config fields are dropped from
 * the body whenever the run is live (no server lock exists — the client owns
 * the protection).
 */
export function AutorunWizardDialog({
  open,
  onClose,
  editing = null,
  prefillProfileId = null,
}: AutorunWizardDialogProps) {
  const { toast } = useToast()
  const engines = useEngines()
  const resolvers = useResolvers()
  const profiles = useProfiles()
  const liveLocked = editing !== null && isLive(editing.status)

  const [step, setStep] = useState(0)
  const [name, setName] = useState(editing?.user_friendly_name ?? "")
  const [slug, setSlug] = useState(editing?.snake_case_name ?? "")
  const [slugTouched, setSlugTouched] = useState(editing !== null)
  const [source, setSource] = useState<"profile" | "custom">(
    editing == null && prefillProfileId != null ? "profile" : "custom",
  )
  const [profileId, setProfileId] = useState<number | null>(editing?.profile_id ?? prefillProfileId)
  const [startLocal, setStartLocal] = useState(editing == null ? "" : naiveUtcToDatetimeLocal(editing.start_time))
  const [endLocal, setEndLocal] = useState(editing == null ? "" : naiveUtcToDatetimeLocal(editing.end_time))
  const [config, setConfig] = useState<ConfigFieldsValue>(() =>
    editing === null
      ? EMPTY_CONFIG
      : {
          engineId: editing.engine_id,
          resolverId: editing.resolver_id,
          resolverConfig: { ...(editing.resolver_config ?? {}) },
          retryMode: editing.retry_mode ?? null,
          retryConfig: { ...(editing.retry_config ?? {}) },
          recording: editing.recording === true,
        },
  )
  const [baseline, setBaseline] = useState<Record<string, unknown>>(() =>
    snapshotFields(editing === null ? {} : configSnapshot(editing)),
  )
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const slugValid = SLUG_RE.test(slug)
  const endAfterStart = startLocal === "" || endLocal === "" || endLocal > startLocal
  const pastStart = startLocal !== "" && new Date(startLocal).getTime() < Date.now()
  const configReady =
    editing !== null || config.engineId != null || (source === "profile" && profileId != null)
  const startReady = startLocal !== "" && endLocal !== "" && endAfterStart
  const canNext =
    (step === 0 && name.trim() !== "" && slugValid) ||
    (step === 1 && startReady) ||
    (step === 2 && configReady) ||
    step === 3

  const applyProfile = (nextId: number | null) => {
    setProfileId(nextId)
    const next = profiles.find((entry: Profile) => entry.id === nextId)
    if (next === undefined) return
    const nextEngine = engines.find((entry) => entry.id === next.default_engine_id)
    const retry = retrySchemaOf(nextEngine, next.retry_mode ?? null)
    const nextConfig: ConfigFieldsValue = {
      engineId: next.default_engine_id,
      resolverId: next.resolver_id,
      resolverConfig: prefillSchemaValues(
        resolvers.find((entry) => entry.id === next.resolver_id)?.config_schema,
        next.resolver_config,
      ),
      retryMode: next.retry_mode ?? null,
      retryConfig: prefillSchemaValues(retry.schema, next.retry_config),
      recording: true,
    }
    setConfig(nextConfig)
    setBaseline(snapshotFields(configSnapshotFrom(nextConfig)))
    setFieldErrors({})
  }

  const reviewRows = useMemo(
    () => [
      ["User-friendly name", name],
      ["Snake-case name", slug],
      [
        "Engine → Resolver",
        `${engines.find((entry) => entry.id === config.engineId)?.name ?? "—"} → ${
          resolvers.find((entry) => entry.id === config.resolverId)?.name ?? "—"
        }`,
      ],
      ["Start", startLocal === "" ? "—" : formatDateTime(datetimeLocalToNaiveUtc(startLocal))],
      ["End", endLocal === "" ? "—" : formatDateTime(datetimeLocalToNaiveUtc(endLocal))],
      ["Recording", config.recording ? "on" : "off"],
    ],
    [name, slug, engines, resolvers, config, startLocal, endLocal],
  )

  const submit = async () => {
    setBusy(true)
    setFieldErrors({})
    setFormError(null)
    try {
      const startTime = datetimeLocalToNaiveUtc(startLocal)
      const endTime = datetimeLocalToNaiveUtc(endLocal)
      if (editing !== null) {
        const current: Record<string, unknown> = {
          user_friendly_name: name,
          snake_case_name: slug,
          start_time: startTime,
          end_time: endTime,
          recording: config.recording,
          ...configSnapshotFrom(config),
        }
        const initial: Record<string, unknown> = {
          user_friendly_name: editing.user_friendly_name,
          snake_case_name: editing.snake_case_name,
          start_time: editing.start_time,
          end_time: editing.end_time,
          recording: editing.recording === true,
          ...snapshotFields(configSnapshot(editing)),
        }
        const dirtyBody: Record<string, unknown> = {}
        for (const key of diffDirtyFields(initial, current)) dirtyBody[key] = current[key]
        if (liveLocked) for (const key of CONFIG_KEYS) delete dirtyBody[key]
        await updateAutorun(editing.id, dirtyBody as AutorunBody)
      } else if (source === "profile" && profileId != null && !isConfigDirty(baseline, config)) {
        await createAutorun({
          user_friendly_name: name,
          snake_case_name: slug,
          profile_id: profileId,
          start_time: startTime,
          end_time: endTime,
          recording: config.recording,
        })
      } else {
        await createAutorun({
          user_friendly_name: name,
          snake_case_name: slug,
          engine_id: config.engineId ?? 0,
          resolver_id: config.resolverId ?? 0,
          resolver_config: config.resolverConfig,
          ...(config.retryMode == null ? {} : { retry_mode: config.retryMode }),
          retry_config: config.retryConfig,
          start_time: startTime,
          end_time: endTime,
          recording: config.recording,
        })
      }
      onClose()
      toast({
        kind: "success",
        title: editing === null ? "Scheduled recording created" : "Scheduled recording saved",
      })
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors !== undefined) setFieldErrors(error.fieldErrors)
      setFormError(describeSubmitError(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wizard
      title={editing === null ? "New scheduled recording" : "Edit scheduled recording"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <span className="ve-inline">
            {step > 0 ? (
              <Button variant="ghost" onClick={() => setStep((current) => current - 1)}>
                Back
              </Button>
            ) : null}
            {step < 3 ? (
              <Button disabled={!canNext} onClick={() => setStep((current) => current + 1)}>
                Next
              </Button>
            ) : (
              <Button loading={busy} onClick={() => void submit()}>
                {editing === null ? "Create" : "Save changes"}
              </Button>
            )}
          </span>
        </>
      }
    >
      <div className="ve-form">
        <nav className="ve-steps" aria-label="Wizard steps">
          {STEP_LABELS.map((label, index) => (
            <span
              key={label}
              className="ve-step"
              data-state={index === step ? "active" : index < step ? "done" : "upcoming"}
              aria-current={index === step ? "step" : undefined}
            >
              {index < step ? `Done · ${label}` : label}
              {index < STEP_LABELS.length - 1 ? <span className="ve-step__rule" aria-hidden="true" /> : null}
            </span>
          ))}
        </nav>

        {formError !== null ? <p className="ve-hint">{formError}</p> : null}

        {step === 0 ? (
          <>
            <Input
              label="User-friendly name"
              value={name}
              error={fieldErrors.user_friendly_name}
              required
              onChange={(event) => {
                const next = event.target.value
                setName(next)
                if (!slugTouched) setSlug(autoSlug(next))
              }}
            />
            <Input
              label="Snake-case name"
              mono
              value={slug}
              required
              error={
                fieldErrors.snake_case_name ??
                (slug !== "" && !slugValid ? "Only letters, numbers, _ and -" : undefined)
              }
              helper="Used in disk paths and exports; unique on this server."
              onChange={(event) => {
                setSlugTouched(true)
                setSlug(event.target.value)
              }}
            />
          </>
        ) : null}

        {step === 1 ? (
          <>
            <Input
              type="datetime-local"
              label="Start"
              value={startLocal}
              required
              error={fieldErrors.start_time}
              helper="Your local time — stored as UTC"
              onChange={(event) => setStartLocal(event.target.value)}
            />
            <Input
              type="datetime-local"
              label="End"
              value={endLocal}
              required
              error={fieldErrors.end_time ?? (endAfterStart ? undefined : "End must be after start")}
              helper="Your local time — stored as UTC"
              onChange={(event) => setEndLocal(event.target.value)}
            />
            {pastStart ? (
              <p className="ve-hint">Start time is in the past — the server will fire it immediately.</p>
            ) : null}
          </>
        ) : null}

        {step === 2 ? (
          <>
            {liveLocked ? (
              <p className="ve-hint">
                Changes affect a future run, not the current one. Moving the end time earlier may stop
                the running recording.
              </p>
            ) : null}
            <Fieldset legend="Configuration source">
              <div className="ve-inline" role="group" aria-label="Configuration source">
                <Chip
                  selected={source === "profile"}
                  disabled={editing !== null}
                  onClick={() => setSource("profile")}
                >
                  From profile
                </Chip>
                <Chip
                  selected={source === "custom"}
                  disabled={editing !== null}
                  onClick={() => setSource("custom")}
                >
                  Direct config
                </Chip>
              </div>
            </Fieldset>
            {source === "profile" && editing === null ? (
              <Select
                label="Profile"
                options={profiles.map((entry: Profile) => ({ value: String(entry.id), label: entry.name }))}
                value={profileId == null ? null : String(profileId)}
                disabled={liveLocked}
                error={fieldErrors.profile_id}
                placeholder="Select a profile…"
                onChange={(next) => applyProfile(Number(next))}
              />
            ) : null}
            <Fieldset
              legend="Engine & resolver"
              disabled={liveLocked}
              disabledReason="Changes affect a future run, not the current one."
            >
              <ConfigFields
                value={config}
                onChange={(next) => setConfig((current) => ({ ...current, ...next }))}
                engines={engines}
                resolvers={resolvers}
                errors={fieldErrors}
                disabled={liveLocked}
              />
            </Fieldset>
          </>
        ) : null}

        {step === 3 ? (
          <Fieldset legend="Review">
            <dl className="ve-kv">
              {reviewRows.map(([label, value]) => (
                <div key={label} style={{ display: "contents" }}>
                  <dt className="ve-kv__label">{label}</dt>
                  <dd className="ve-kv__value">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="ve-note">Runs once at the start time, then retires.</p>
          </Fieldset>
        ) : null}
      </div>
    </Dialog>
  )
}
