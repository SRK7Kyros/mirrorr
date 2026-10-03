import { useState } from "react"
import { Dialog } from "@/components/ui/Dialog"
import { Input } from "@/components/ui/Input"
import { Button } from "@/components/ui/Button"
import { Fieldset } from "@/components/ui/FormField"
import { useToast } from "@/components/ui/Toast"
import { ApiError } from "@/lib/api"
import type { Profile } from "@/lib/schemas"
import { createProfile, updateProfile } from "@/views/shared/api"
import { useEngines, useResolvers } from "@/views/shared/hooks"
import { ConfigFields, type ConfigFieldsValue } from "@/views/shared/config-fields"
import "@/styles/views-entities.css"

export interface ProfileEditorDialogProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly editing?: Profile | null
}

function configOf(profile: Profile | null): ConfigFieldsValue {
  if (profile === null) {
    return { engineId: null, resolverId: null, resolverConfig: {}, retryMode: null, retryConfig: {}, recording: false }
  }
  return {
    engineId: profile.default_engine_id,
    resolverId: profile.resolver_id,
    resolverConfig: { ...(profile.resolver_config ?? {}) },
    retryMode: profile.retry_mode ?? null,
    retryConfig: { ...(profile.retry_config ?? {}) },
    recording: false,
  }
}

/** §5.8 primary — New/Edit profile, dynamic form from the resolver + retry schemas. */
export function ProfileEditorDialog({ open, onClose, editing = null }: ProfileEditorDialogProps) {
  const engines = useEngines()
  const resolvers = useResolvers()
  const { toast } = useToast()
  const [name, setName] = useState(editing?.name ?? "")
  const [config, setConfig] = useState<ConfigFieldsValue>(() => configOf(editing))
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setFieldErrors({})
    const body = {
      name,
      default_engine_id: config.engineId ?? 0,
      resolver_id: config.resolverId ?? 0,
      resolver_config: config.resolverConfig,
      ...(config.retryMode == null ? {} : { retry_mode: config.retryMode }),
      retry_config: config.retryConfig,
    }
    try {
      if (editing === null) await createProfile(body)
      else await updateProfile(editing.id, body)
      onClose()
      toast({ kind: "success", title: editing === null ? "Profile created" : "Profile saved" })
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors !== undefined) setFieldErrors(error.fieldErrors)
      if (error instanceof ApiError && error.status === 400) {
        setFieldErrors((current) => ({ ...current, name: error.message }))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing === null ? "New profile" : "Edit profile"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            Save
          </Button>
        </>
      }
    >
      <div className="ve-form">
        <Input
          label="Name"
          value={name}
          required
          error={fieldErrors.name}
          helper="Duplicate names are rejected by the server."
          onChange={(event) => setName(event.target.value)}
        />
        <Fieldset legend="Engine, resolver & retry">
          <ConfigFields
            value={config}
            onChange={(next) => setConfig((current) => ({ ...current, ...next }))}
            engines={engines}
            resolvers={resolvers}
            errors={fieldErrors}
            showRecording={false}
          />
        </Fieldset>
        <p className="ve-note">
          Fields are generated from the resolver `config_schema` and the engine retry-mode schema.
        </p>
      </div>
    </Dialog>
  )
}
