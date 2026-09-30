import { useState } from "react"
import { Button } from "@/components/ui/Button"
import { Dialog } from "@/components/ui/Dialog"
import { Select } from "@/components/ui/Select"
import { useToast } from "@/components/ui/Toast"
import { ApiError } from "@/lib/api"
import type { Profile } from "@/lib/schemas"
import { prefillSchemaValues } from "@/components/ui/dynamic-schema-form"
import { createSession, type SessionCreateBody } from "@/views/shared/api"
import { useEngines, useProfiles, useResolvers } from "@/views/shared/hooks"
import { isDirty, snapshotFields } from "@/views/shared/dirty"
import { useLooseNavigate } from "@/views/shared/parts"
import {
  ConfigFields,
  type ConfigFieldsValue,
  retrySchemaOf,
} from "@/views/shared/config-fields"

export interface NewSessionDialogProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly prefillProfileId?: number | null
}

const CONFIG_KEYS = ["engine_id", "resolver_id", "resolver_config", "retry_mode", "retry_config"] as const

const EMPTY_CONFIG: ConfigFieldsValue = {
  engineId: null,
  resolverId: null,
  resolverConfig: {},
  retryMode: null,
  retryConfig: {},
  recording: false,
}

function configOf(value: ConfigFieldsValue): Record<string, unknown> {
  return {
    engine_id: value.engineId,
    resolver_id: value.resolverId,
    resolver_config: { ...value.resolverConfig },
    retry_mode: value.retryMode,
    retry_config: { ...value.retryConfig },
  }
}

/**
 * D1 — New Session dialog. Source toggle "From profile" (select prefills all
 * fields, still editable) / "Custom"; DynamicSchemaForm drives resolver_config
 * + retry_config; the recording switch is disabled-but-visible with
 * "Engine cannot record" when `can_record === false`. No date fields —
 * sessions start immediately. Dirty rule (contract): an UNEDITED "From
 * profile" submission sends `{profile_id, recording}` only; ANY single field
 * edit switches the body to the full explicit form — per-field dirty tracking,
 * all-or-nothing submission (the server snapshots config at create).
 */
export function NewSessionDialog({ open, onClose, prefillProfileId = null }: NewSessionDialogProps) {
  const navigate = useLooseNavigate()
  const { toast } = useToast()
  const engines = useEngines()
  const resolvers = useResolvers()
  const profiles = useProfiles()

  const [source, setSource] = useState<"profile" | "custom">(
    prefillProfileId != null ? "profile" : "custom",
  )
  const [profileId, setProfileId] = useState<number | null>(prefillProfileId)
  const [config, setConfig] = useState<ConfigFieldsValue>(EMPTY_CONFIG)
  const [baseline, setBaseline] = useState<Record<string, unknown>>(() => snapshotFields(configOf(EMPTY_CONFIG)))
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const applyProfile = (nextId: number | null) => {
    setProfileId(nextId)
    const next = profiles.find((entry: Profile) => entry.id === nextId)
    if (next === undefined) return
    const nextEngine = engines.find((entry) => entry.id === next.default_engine_id)
    const retry = retrySchemaOf(nextEngine, next.retry_mode ?? null)
    const filled: ConfigFieldsValue = {
      engineId: next.default_engine_id,
      resolverId: next.resolver_id,
      resolverConfig: prefillSchemaValues(
        resolvers.find((entry) => entry.id === next.resolver_id)?.config_schema,
        next.resolver_config,
      ),
      retryMode: next.retry_mode ?? null,
      retryConfig: prefillSchemaValues(retry.schema, next.retry_config),
      recording: false,
    }
    setConfig(filled)
    setBaseline(snapshotFields(configOf(filled)))
    setFieldErrors({})
  }

  const configDirty = isDirty(baseline, configOf(config), CONFIG_KEYS)

  const submit = async () => {
    setBusy(true)
    setFieldErrors({})
    setFormError(null)
    const body: SessionCreateBody =
      source === "profile" && profileId != null && !configDirty
        ? { profile_id: profileId, recording: config.recording }
        : {
            ...(config.engineId == null ? {} : { engine_id: config.engineId }),
            ...(config.resolverId == null ? {} : { resolver_id: config.resolverId }),
            resolver_config: config.resolverConfig,
            ...(config.retryMode == null ? {} : { retry_mode: config.retryMode }),
            retry_config: config.retryConfig,
            recording: config.recording,
          }
    try {
      const session = await createSession(body)
      onClose()
      void navigate({ to: "/sessions/$sessionId", params: { sessionId: String(session.id) } })
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors !== undefined) setFieldErrors(error.fieldErrors)
      setFormError(error instanceof ApiError ? error.message : "Could not start session")
      toast({ kind: "error", title: "Could not start session" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New session"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            Start session
          </Button>
        </>
      }
    >
      <div className="stack" style={{ gap: "var(--space-md)" }}>
        <div className="filter-chips" role="group" aria-label="Config source">
          <button
            type="button"
            className="chip-btn"
            data-active={source === "profile"}
            onClick={() => setSource("profile")}
          >
            From profile
          </button>
          <button
            type="button"
            className="chip-btn"
            data-active={source === "custom"}
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
            onChange={(next) => applyProfile(Number(next))}
            error={fieldErrors.profile_id}
          />
        ) : null}

        <ConfigFields
          value={config}
          onChange={(next) => setConfig((current) => ({ ...current, ...next }))}
          engines={engines}
          resolvers={resolvers}
          errors={fieldErrors}
        />

        {formError !== null ? <p className="warn-text">{formError}</p> : null}
      </div>
    </Dialog>
  )
}
