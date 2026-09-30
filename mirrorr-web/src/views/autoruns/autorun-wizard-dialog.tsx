import { useMemo, useState } from "react"
import { Button } from "@/components/ui/Button"
import { Dialog } from "@/components/ui/Dialog"
import { Input } from "@/components/ui/Input"
import { Select } from "@/components/ui/Select"
import { useToast } from "@/components/ui/Toast"
import { ApiError } from "@/lib/api"
import type { Autorun, Profile } from "@/lib/schemas"
import {
  datetimeLocalToNaiveUtc,
  formatDateTime,
  naiveUtcToDatetimeLocal,
} from "@/lib/time"
import { createAutorun, updateAutorun, type AutorunBody } from "@/views/shared/api"
import { useEngines, useProfiles, useResolvers } from "@/views/shared/hooks"
import { diffDirtyFields, isDirty, snapshotFields } from "@/views/shared/dirty"
import { prefillSchemaValues, type SchemaValues } from "@/components/ui/dynamic-schema-form"
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

function autoSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
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
 * D2 — Autorun create/edit wizard (4 steps: Identity · Schedule · Config ·
 * Review). `datetime-local` inputs convert via `@/lib/time`
 * (`datetimeLocalToNaiveUtc`) — naive UTC, no suffix. Submission semantics
 * (contract): create unedited-from-profile sends
 * `{user_friendly_name, snake_case_name, profile_id, start_time, end_time,
 * recording}`; any config edit switches to the full explicit body (replaces
 * profile_id). EDIT mode `PUT` sends ONLY dirty fields (exclude_unset
 * semantics) — locked fields while live are never sent.
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
  const [source, setSource] = useState<"profile" | "custom">(editing == null && prefillProfileId != null ? "profile" : "custom")
  const [profileId, setProfileId] = useState<number | null>(editing?.profile_id ?? prefillProfileId)
  const [startLocal, setStartLocal] = useState(editing == null ? "" : naiveUtcToDatetimeLocal(editing.start_time))
  const [endLocal, setEndLocal] = useState(editing == null ? "" : naiveUtcToDatetimeLocal(editing.end_time))
  const [config, setConfig] = useState<ConfigFieldsValue>(() => {
    if (editing === null) return EMPTY_CONFIG
    return {
      engineId: editing.engine_id,
      resolverId: editing.resolver_id,
      resolverConfig: { ...(editing.resolver_config ?? {}) },
      retryMode: editing.retry_mode ?? null,
      retryConfig: { ...(editing.retry_config ?? {}) },
      recording: editing.recording === true,
    }
  })
  const [baseline, setBaseline] = useState<Record<string, unknown>>(() =>
    snapshotFields(editing === null ? {} : configSnapshot(editing)),
  )
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const configDirty = isDirty(
    baseline,
    configSnapshotFrom(config),
    ["engine_id", "resolver_id", "resolver_config", "retry_mode", "retry_config"],
  )

  const slugValid = SLUG_RE.test(slug)
  const endAfterStart = startLocal === "" || endLocal === "" || endLocal > startLocal
  const pastStart = startLocal !== "" && new Date(startLocal).getTime() < Date.now()

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

  const canNext =
    (step === 0 && name.trim() !== "" && slugValid) ||
    (step === 1 && startLocal !== "" && endAfterStart) ||
    step === 2 ||
    step === 3

  const submit = async () => {
    setBusy(true)
    setFieldErrors({})
    setFormError(null)
    try {
      const startTime = datetimeLocalToNaiveUtc(startLocal)
      const endTime = datetimeLocalToNaiveUtc(endLocal)
      let body: AutorunBody
      if (editing !== null) {
        // PUT = dirty fields ONLY (exclude_unset semantics); locked fields never sent.
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
        const dirty = diffDirtyFields(initial, current)
        const dirtyBody: Record<string, unknown> = {}
        for (const key of dirty) dirtyBody[key] = current[key]
        if (liveLocked) {
          delete dirtyBody.engine_id
          delete dirtyBody.resolver_id
          delete dirtyBody.resolver_config
          delete dirtyBody.retry_mode
          delete dirtyBody.retry_config
        }
        body = dirtyBody as AutorunBody
        await updateAutorun(editing.id, body)
      } else if (source === "profile" && profileId != null && !configDirty) {
        body = {
          user_friendly_name: name,
          snake_case_name: slug,
          profile_id: profileId,
          start_time: startTime,
          end_time: endTime,
          recording: config.recording,
        }
        await createAutorun(body)
      } else {
        body = {
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
        }
        await createAutorun(body)
      }
      onClose()
      toast({
        kind: "success",
        title: editing === null ? "Autorun created" : "Autorun saved",
      })
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors !== undefined) setFieldErrors(error.fieldErrors)
      setFormError(error instanceof ApiError ? error.message : "Could not save autorun")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wizard
      title={editing === null ? "New autorun" : "Edit autorun"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <span className="cluster">
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
                {editing === null ? "Create autorun" : "Save changes"}
              </Button>
            )}
          </span>
        </>
      }
    >
      <nav className="step-indicator" aria-label="Wizard steps">
        {STEP_LABELS.map((label, index) => (
          <span key={label} className="step-indicator__step" data-state={index === step ? "active" : index < step ? "done" : "upcoming"}>
            {index < step ? `✓ ${label}` : label}
            {index < STEP_LABELS.length - 1 ? <span className="step-indicator__rule" /> : null}
          </span>
        ))}
      </nav>

      {formError !== null ? <p className="warn-text">{formError}</p> : null}

      {step === 0 ? (
        <div className="stack" style={{ gap: "var(--space-md)" }}>
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
            error={fieldErrors.snake_case_name ?? (slug !== "" && !slugValid ? "Only letters, numbers, _ and -" : undefined)}
            helper={slugValid && slug !== "" ? `slug: ${slug}` : "Only letters, numbers, _ and -"}
            onChange={(event) => {
              setSlugTouched(true)
              setSlug(event.target.value)
            }}
          />
        </div>
      ) : null}

      {step === 1 ? (
        <div className="stack" style={{ gap: "var(--space-md)" }}>
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
            <p className="warn-text">
              Start is in the past — starts immediately; the server treats past times as a backfill
              trigger
            </p>
          ) : null}
        </div>
      ) : null}

      {step === 2 ? (
        <div className="stack" style={{ gap: "var(--space-md)" }}>
          {liveLocked ? (
            <p className="warn-text">
              This autorun is running — only name and times can change; setting an end time in the
              past stops the current run
            </p>
          ) : null}
          <div className="filter-chips" role="group" aria-label="Config source">
            <button
              type="button"
              className="chip-btn"
              data-active={source === "profile"}
              disabled={editing !== null}
              onClick={() => setSource("profile")}
            >
              From profile
            </button>
            <button
              type="button"
              className="chip-btn"
              data-active={source === "custom"}
              disabled={editing !== null}
              onClick={() => setSource("custom")}
            >
              Custom
            </button>
          </div>
          {source === "profile" ? (
            <Select
              label="Profile"
              options={profiles.map((entry: Profile) => ({ value: String(entry.id), label: entry.name }))}
              value={profileId == null ? null : String(profileId)}
              disabled={liveLocked}
              error={fieldErrors.profile_id}
              onChange={(next) => applyProfile(Number(next))}
            />
          ) : null}
          <ConfigFields
            value={config}
            onChange={(next) => setConfig((current) => ({ ...current, ...next }))}
            engines={engines}
            resolvers={resolvers}
            errors={fieldErrors}
            disabled={liveLocked}
          />
        </div>
      ) : null}

      {step === 3 ? (
        <div className="card">
          <dl className="kv">
            {reviewRows.map(([label, value]) => (
              <div key={label} style={{ display: "contents" }}>
                <dt className="kv__label">{label}</dt>
                <dd className="kv__value t-mono">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </Dialog>
  )
}



export type { SchemaValues }
