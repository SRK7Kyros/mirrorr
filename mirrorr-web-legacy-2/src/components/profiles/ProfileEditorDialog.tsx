/**
 * D2 — the profile editor (spec L323-L337).
 *
 * Engine/resolver pickers, `resolver_config` from the resolver's
 * `config_schema`, `retry_mode` + `retry_config` from the engine's
 * `retry_modes_schema[mode]` (a mode change re-renders its schema). Server
 * outcomes: 400 duplicate name → inline name error; 422 `resolver_config.url`
 * → inline via `DynamicSchemaForm`'s dotted-path lookup.
 */
import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { DynamicSchemaForm } from "@/components/forms/DynamicSchemaForm"
import { Button } from "@/components/ui/Button"
import { Dialog } from "@/components/ui/Dialog"
import { Input } from "@/components/ui/Input"
import { Select } from "@/components/ui/Select"
import { useNameMap } from "@/hooks/use-name-map"
import type { EntityStore } from "@/lib/entity-store"
import { entityStore } from "@/lib/entity-store-client"
import { ApiError, userMessageForError } from "@/lib/errors"
import { createEntity } from "@/lib/optimistic-policy"
import {
  applyProfileEngine,
  applyProfileResolver,
  applyProfileRetryMode,
  buildProfileBody,
  createEmptyProfileForm,
  profileFormErrors,
  profileFormFromProfile,
  retryModeOptions,
  type ProfileFormState,
} from "@/lib/profile-form"
import { createProfile, updateProfile } from "@/lib/profiles-api"
import { QUERY_STALE_TIMES_MS, queryKeys } from "@/lib/query-keys"
import { fetchAllEngines, fetchAllResolvers } from "@/lib/sessions-api"
import type { Profile } from "@/lib/schemas/plugins"
import { showToast } from "@/lib/toast"
import { useQueryClient } from "@tanstack/react-query"

export interface ProfileEditorDialogProps {
  readonly open: boolean
  /** `null` = create; a profile = edit. */
  readonly profile: Profile | null
  readonly onClose: () => void
  readonly store?: EntityStore
}

export function ProfileEditorDialog({ open, profile, onClose, store = entityStore }: ProfileEditorDialogProps) {
  const queryClient = useQueryClient()
  const { invalidateNames } = useNameMap()
  const [form, setForm] = useState<ProfileFormState>(createEmptyProfileForm)
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({})
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm(profile === null ? createEmptyProfileForm() : profileFormFromProfile(profile))
    setErrors({})
    setSubmitting(false)
  }, [open, profile])

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

  const engines = enginesQuery.data ?? []
  const resolvers = resolversQuery.data ?? []
  const engine = useMemo(() => engines.find((item) => item.id === form.engineId) ?? null, [engines, form.engineId])
  const resolver = useMemo(
    () => resolvers.find((item) => item.id === form.resolverId) ?? null,
    [resolvers, form.resolverId],
  )
  const retrySchema = engine?.retry_modes_schema?.[form.retryMode]?.schema

  async function handleSubmit() {
    const body = buildProfileBody(form)
    const nextErrors = profileFormErrors(form, resolver)
    setErrors(nextErrors)
    if (body === null || Object.keys(nextErrors).length > 0) return

    setSubmitting(true)
    try {
      if (profile === null) {
        const created = await createEntity(store, { resource: "profile", mutate: () => createProfile(body) })
        showToast(`Profile "${created.name}" created`, "info")
      } else {
        const updated = await updateProfile(profile.id, body)
        store.applyAuthoritativeSnapshot("profile", updated.id, updated, { insert: false })
        showToast(`Profile "${updated.name}" saved`, "info")
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.profilesAll(), type: "all" })
      if (profile !== null) void queryClient.invalidateQueries({ queryKey: queryKeys.profile(profile.id) })
      invalidateNames("profile")
      onClose()
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        setErrors({ name: error.detail })
      } else {
        const fieldErrors = error instanceof ApiError ? error.fieldErrors : undefined
        if (fieldErrors !== undefined && Object.keys(fieldErrors).length > 0) {
          setErrors(fieldErrors)
        } else {
          showToast(userMessageForError(error))
        }
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={profile === null ? "New profile" : "Edit profile"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleSubmit()} disabled={submitting}>
            {profile === null ? "Create profile" : "Save changes"}
          </Button>
        </>
      }
    >
      <div data-testid="profile-editor" className="flex flex-col gap-4">
        <Input
          label="Name"
          value={form.name}
          error={errors.name}
          onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
        />

        <Select
          label="Engine"
          value={form.engineId === null ? "" : String(form.engineId)}
          error={errors.default_engine_id}
          onChange={(event) =>
            setForm((prev) =>
              applyProfileEngine(prev, engines.find((item) => String(item.id) === event.target.value) ?? null),
            )
          }
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
          onChange={(event) =>
            setForm((prev) =>
              applyProfileResolver(prev, resolvers.find((item) => String(item.id) === event.target.value) ?? null),
            )
          }
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
              idPrefix="profile-resolver-config"
              onChange={(next) => setForm((prev) => ({ ...prev, resolverConfig: next }))}
            />
          </section>
        ) : null}

        <Select
          label="Retry mode"
          value={form.retryMode}
          onChange={(event) =>
            setForm((prev) => applyProfileRetryMode(prev, engine, event.target.value))
          }
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
              idPrefix="profile-retry-config"
              onChange={(next) => setForm((prev) => ({ ...prev, retryConfig: next }))}
            />
          </section>
        ) : null}
      </div>
    </Dialog>
  )
}
