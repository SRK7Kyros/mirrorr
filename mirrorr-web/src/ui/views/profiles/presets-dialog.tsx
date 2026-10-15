import { useEffect, useState, type FormEvent, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ApiError,
  createProfile,
  createSource,
  getErrorMessage,
  updateProfile,
  updateSource,
  useProfiles,
  useSources,
  type ProfileBody,
  type SourceBody,
} from "@/api"
import { fetchAllEngines, fetchAllResolvers } from "@/api/endpoints"
import { queryKeys, queryRoots, staleTimes } from "@/api/query-keys"
import type { Engine, Profile, Resolver, ResolverSource } from "@/api/schemas"
import { humanize } from "@/ui/lib/format"
import {
  asObject,
  Banner,
  Button,
  defaultsFromSchema,
  Dialog,
  Field,
  IconCheck,
  IconSearch,
  Input,
  JsonView,
  SchemaForm,
  Segmented,
  Select,
  SkeletonRows,
  TabPanel,
  toast,
  panelTitleClass,
} from "@/ui/components"
import { DiscoveryDrawer } from "./discovery-drawer"

/**
 * The create/edit dialog for both things the Presets page holds.
 *
 * A profile is a whole recording setup (engine + resolver config + retry
 * policy); a source is only the saved `(resolver_id, resolver_config)` pair.
 * They used to be two dialogs behind two floating "+" buttons stacked in the
 * same corner, so on touch layouts the source one always won the tap and a
 * profile could not be created at all. Now a single "+" opens this one dialog
 * with a segmented switcher between the two kinds, and the desktop section
 * buttons open the same dialog on their own tab.
 *
 * The profile body also separates the two ways its resolver config can arrive.
 * Both used to be live at once — a resolver picker *and* a "load from a saved
 * source" picker, either of which silently overwrote the other — so a second
 * segmented control ("Pick a resolver" / "Use a saved source") now decides it,
 * and only the chosen mode's controls are rendered. Switching to "Pick a
 * resolver" keeps whatever the saved source copied in, so the copy stays
 * editable; only the *link* to the source is dropped.
 */

export type PresetKind = "profile" | "source"

/** Where the profile's resolver config comes from — exactly one of the two. */
type ResolverMode = "resolver" | "source"

export interface PresetsDialogProps {
  readonly open: boolean
  /** Which tab opens first; also the kind being edited. */
  readonly kind: PresetKind
  /** Edit target on the profile tab (`null` creates). */
  readonly profile: Profile | null
  /** Edit target on the source tab (`null` creates). */
  readonly source: ResolverSource | null
  readonly onClose: () => void
}

const PROFILE_FORM_ID = "preset-profile-form"
const SOURCE_FORM_ID = "preset-source-form"

interface FormBlockProps {
  /** Short index shown in the accent disc — the order the form is read in. */
  readonly step: string
  readonly title: string
  /** One-line note on the right of the header (what this part decides). */
  readonly hint?: string
  readonly children: ReactNode
}

/** One numbered part of a form, so the parts never blur into one another. */
function FormBlock({ step, title, hint, children }: FormBlockProps) {
  return (
    <section className="flex flex-col gap-3 rounded-md border border-line-subtle bg-surface-1 p-4 max-sm:p-3">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-[var(--accent-line)] bg-[var(--accent-dim)] text-xs font-semibold tabular-nums text-brand"
          aria-hidden="true"
        >
          {step}
        </span>
        <h3 className="text-sm font-semibold tracking-wider text-ink uppercase">{title}</h3>
        {hint !== undefined ? <span className="ms-auto text-sm text-ink-dim">{hint}</span> : null}
      </header>
      {children}
    </section>
  )
}

export function PresetsDialog({ open, kind, profile, source, onClose }: PresetsDialogProps) {
  const queryClient = useQueryClient()
  const enginesQuery = useQuery({
    queryKey: queryKeys.engines,
    queryFn: () => fetchAllEngines(),
    staleTime: staleTimes.lookup,
  })
  const resolversQuery = useQuery({
    queryKey: queryKeys.resolvers,
    queryFn: () => fetchAllResolvers(),
    staleTime: staleTimes.lookup,
  })
  // Full lists, not the panel's loaded page — duplicate names are checked
  // against everything that exists. Same query keys, so no extra request.
  const profiles = useProfiles()
  const sources = useSources()

  const engines: readonly Engine[] = enginesQuery.data ?? []
  const resolvers: readonly Resolver[] = resolversQuery.data ?? []
  const schemasLoading = enginesQuery.isLoading || resolversQuery.isLoading

  const [tab, setTab] = useState<PresetKind>(kind)

  // Profile body
  const [name, setName] = useState("")
  const [engineId, setEngineId] = useState("")
  const [resolverId, setResolverId] = useState("")
  const [resolverConfig, setResolverConfig] = useState<Record<string, unknown>>({})
  const [retryMode, setRetryMode] = useState("")
  const [retryConfig, setRetryConfig] = useState<Record<string, unknown>>({})
  const [mode, setMode] = useState<ResolverMode>("resolver")
  const [pickedSourceId, setPickedSourceId] = useState("")

  // Source body
  const [sourceName, setSourceName] = useState("")
  const [sourceResolverId, setSourceResolverId] = useState("")
  const [sourceConfig, setSourceConfig] = useState<Record<string, unknown>>({})
  const [browseOpen, setBrowseOpen] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({})

  // Reset the whole dialog each time it opens — create after create, or a
  // different row. `profile`/`source` identity is stable while it is open.
  useEffect(() => {
    if (!open) return
    setTab(kind)
    setName(profile?.name ?? "")
    setEngineId(profile !== null ? String(profile.default_engine_id) : "")
    setResolverId(profile !== null ? String(profile.resolver_id) : "")
    setResolverConfig(profile?.resolver_config ?? {})
    setRetryMode(profile?.retry_mode ?? "")
    setRetryConfig(profile?.retry_config ?? {})
    setMode("resolver")
    setPickedSourceId("")
    setSourceName(source?.name ?? "")
    setSourceResolverId(source !== null ? String(source.resolver_id) : "")
    setSourceConfig(source?.resolver_config ?? {})
    setBrowseOpen(false)
    setError(null)
    setFieldErrors({})
  }, [open, kind, profile, source])

  const saveProfile = useMutation({
    mutationFn: (body: ProfileBody) =>
      profile === null ? createProfile(body) : updateProfile(profile.id, body),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: queryRoots.profiles })
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile(saved.id) })
      toast.success(profile === null ? "Profile created" : "Profile updated", saved.name)
      onClose()
    },
    onError: (caught) => {
      if (caught instanceof ApiError && caught.fieldErrors !== undefined) setFieldErrors(caught.fieldErrors)
      setError(getErrorMessage(caught, "Could not save the profile"))
    },
  })

  const saveSource = useMutation({
    mutationFn: (body: SourceBody) =>
      source === null ? createSource(body) : updateSource(source.id, body),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: queryRoots.sources })
      void queryClient.invalidateQueries({ queryKey: queryKeys.source(saved.id) })
      toast.success(source === null ? "Source created" : "Source updated", saved.name)
      onClose()
    },
    onError: (caught) => {
      if (caught instanceof ApiError && caught.fieldErrors !== undefined) setFieldErrors(caught.fieldErrors)
      setError(getErrorMessage(caught, "Could not save the source"))
    },
  })

  const engine = engines.find((item) => String(item.id) === engineId)
  const resolver = resolvers.find((item) => String(item.id) === resolverId)
  const retryModes = asObject(engine?.retry_modes_schema)
  const retryModeKeys = Object.keys(retryModes)
  const retryEntry = asObject(retryModeKeys.includes(retryMode) ? retryModes[retryMode] : undefined)
  const retrySchema = asObject(retryEntry["schema"])

  const pickedSource = sources.find((item) => String(item.id) === pickedSourceId)

  const sourceResolver = resolvers.find((item) => String(item.id) === sourceResolverId)
  const canBrowse = sourceResolver !== undefined && Object.keys(asObject(sourceResolver.search_schema)).length > 0

  const editing = tab === "profile" ? profile !== null : source !== null

  const duplicateName =
    name.trim() !== "" &&
    profiles.some(
      (item) => item.id !== (profile?.id ?? -1) && item.name.toLowerCase() === name.trim().toLowerCase(),
    )
  const duplicateSourceName =
    sourceName.trim() !== "" &&
    sources.some(
      (item) => item.id !== (source?.id ?? -1) && item.name.toLowerCase() === sourceName.trim().toLowerCase(),
    )

  function changeEngine(nextId: string): void {
    setEngineId(nextId)
    setRetryMode("")
    setRetryConfig({})
  }

  function changeResolver(nextId: string): void {
    setResolverId(nextId)
    setResolverConfig(defaultsFromSchema(resolvers.find((item) => String(item.id) === nextId)?.config_schema))
  }

  function changeResolverMode(next: ResolverMode): void {
    setMode(next)
    setError(null)
    setFieldErrors({})
    // Leaving the source mode drops the *link* only: the resolver and config it
    // copied stay in the form, so "Pick a resolver" is a genuine continuation.
    if (next === "resolver") setPickedSourceId("")
  }

  function pickSource(nextId: string): void {
    setPickedSourceId(nextId)
    const picked = sources.find((item) => String(item.id) === nextId)
    if (picked === undefined) return
    setResolverId(String(picked.resolver_id))
    setResolverConfig(picked.resolver_config ?? {})
  }

  function changeSourceResolver(nextId: string): void {
    setSourceResolverId(nextId)
    setSourceConfig(defaultsFromSchema(resolvers.find((item) => String(item.id) === nextId)?.config_schema))
  }

  function changeRetryMode(nextMode: string): void {
    setRetryMode(nextMode)
    setRetryConfig(asObject(asObject(retryModes[nextMode])["default_params"]))
  }

  function submitProfile(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (saveProfile.isPending) return
    setError(null)
    const invalid: Record<string, string> = {}
    if (name.trim() === "") invalid.name = "Name is required."
    if (engineId === "") invalid.default_engine_id = "Pick an engine."
    if (resolverId === "") {
      invalid.resolver_id = mode === "source" ? "Pick a saved source." : "Pick a resolver."
    }
    setFieldErrors(invalid)
    if (Object.keys(invalid).length > 0) return
    saveProfile.mutate({
      name: name.trim(),
      default_engine_id: Number(engineId),
      resolver_id: Number(resolverId),
      resolver_config: resolverConfig,
      ...(retryMode === "" ? {} : { retry_mode: retryMode, retry_config: retryConfig }),
    })
  }

  function submitSource(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (saveSource.isPending) return
    setError(null)
    const invalid: Record<string, string> = {}
    if (sourceName.trim() === "") invalid.name = "Name is required."
    if (sourceResolverId === "") invalid.resolver_id = "Pick a resolver."
    setFieldErrors(invalid)
    if (Object.keys(invalid).length > 0) return
    saveSource.mutate({
      name: sourceName.trim(),
      resolver_id: Number(sourceResolverId),
      resolver_config: sourceConfig,
    })
  }

  const pending = tab === "profile" ? saveProfile.isPending : saveSource.isPending
  const submitDisabled =
    tab === "profile" ? duplicateName || name.trim() === "" : duplicateSourceName || sourceName.trim() === ""

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? (tab === "profile" ? "Edit profile" : "Edit source") : "New preset"}
      description={
        editing
          ? tab === "profile"
            ? "Change its engine, resolver config or retry policy."
            : "Change the resolver and the config saved with it."
          : "A profile is a complete recording setup — engine, resolver config and retry policy. A source is just a saved resolver config."
      }
      busy={pending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={tab === "profile" ? PROFILE_FORM_ID : SOURCE_FORM_ID}
            loading={pending}
            disabled={submitDisabled}
          >
            {editing ? "Save changes" : tab === "profile" ? "Create profile" : "Create source"}
          </Button>
        </>
      }
    >
      {!editing ? (
        <Field label="What are you creating?">
          <Segmented
            ariaLabel="What are you creating?"
            panelId="preset-kind"
            active={tab}
            onChange={(next) => {
              setTab(next)
              setError(null)
              setFieldErrors({})
            }}
            items={[
              { id: "profile", label: "Profile" },
              { id: "source", label: "Source" },
            ]}
          />
        </Field>
      ) : null}

      <TabPanel panelId="preset-kind" active={tab} className="flex flex-col gap-4">
        {tab === "profile" ? (
          <form id={PROFILE_FORM_ID} className="flex flex-col gap-4" onSubmit={submitProfile}>
            {error !== null ? <Banner kind="danger" title={error} /> : null}

            <FormBlock step="1" title="Identity">
              <Field
                label="Name"
                htmlFor="preset-profile-name"
                required
                error={
                  duplicateName ? "A profile with this name already exists." : (fieldErrors.name ?? null)
                }
                hint="How it is listed in the session and autorun pickers."
              >
                <Input
                  id="preset-profile-name"
                  value={name}
                  autoComplete="off"
                  placeholder="e.g. nightly-news"
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
            </FormBlock>

            <FormBlock step="2" title="Engine" hint="what records it">
              <Field
                label="Engine"
                htmlFor="preset-profile-engine"
                required
                error={fieldErrors.default_engine_id ?? fieldErrors.engine_id ?? null}
                hint={
                  engine === undefined
                    ? "Engines come from the installed plugins."
                    : `${Object.keys(asObject(engine.retry_modes_schema)).length} retry mode(s) available.`
                }
              >
                <Select
                  id="preset-profile-engine"
                  value={engineId}
                  onChange={(event) => changeEngine(event.target.value)}
                >
                  <option value="">Select an engine…</option>
                  {engines.map((item) => (
                    <option key={item.id} value={String(item.id)}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </FormBlock>

            <FormBlock
              step="3"
              title="Source"
              hint={mode === "resolver" ? "configure a resolver" : "copy a saved source"}
            >
              <Field label="How is the stream config set?">
                <Segmented
                  ariaLabel="How is the stream config set?"
                  panelId="preset-resolver-mode"
                  active={mode}
                  onChange={changeResolverMode}
                  items={[
                    { id: "resolver", label: "Pick a resolver" },
                    { id: "source", label: "Use a saved source", disabled: sources.length === 0 },
                  ]}
                />
              </Field>

              <TabPanel panelId="preset-resolver-mode" active={mode} className="flex flex-col gap-4">
                {mode === "resolver" ? (
                  <>
                    <Field
                      label="Resolver"
                      htmlFor="preset-profile-resolver"
                      required
                      error={fieldErrors.resolver_id ?? null}
                    >
                      <Select
                        id="preset-profile-resolver"
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

                    <section className="flex flex-col gap-2">
                      <h4 className={panelTitleClass}>Resolver config</h4>
                      {schemasLoading ? (
                        <SkeletonRows rows={3} cols={2} />
                      ) : resolver === undefined ? (
                        <p className="text-ink-dim" style={{ fontSize: "var(--fs-sm)" }}>
                          Pick a resolver to configure it.
                        </p>
                      ) : (
                        <SchemaForm
                          schema={resolver.config_schema}
                          value={resolverConfig}
                          onChange={setResolverConfig}
                          idPrefix="preset-profile-resolver-config"
                        />
                      )}
                      {fieldErrors.resolver_config !== undefined ? (
                        <span className="flex items-center gap-1 text-sm text-danger" role="alert">
                          {fieldErrors.resolver_config}
                        </span>
                      ) : null}
                    </section>
                  </>
                ) : (
                  <>
                    <Field
                      label="Saved source"
                      htmlFor="preset-profile-source"
                      required
                      error={fieldErrors.resolver_id ?? null}
                      hint="Its resolver and config are copied into this profile."
                    >
                      <Select
                        id="preset-profile-source"
                        value={pickedSourceId}
                        onChange={(event) => pickSource(event.target.value)}
                      >
                        <option value="">Pick a saved source…</option>
                        {sources.map((item) => (
                          <option key={item.id} value={String(item.id)}>
                            {item.name}
                          </option>
                        ))}
                      </Select>
                    </Field>

                    {pickedSource === undefined ? (
                      <p className="text-ink-dim" style={{ fontSize: "var(--fs-sm)" }}>
                        {sources.length === 0
                          ? "No saved sources yet — create one from the Source tab."
                          : "Pick a source to see what it fills in."}
                      </p>
                    ) : (
                      <div className="flex flex-col gap-3 rounded-sm border border-[var(--accent-line)] bg-[var(--accent-dim)] p-3">
                        <p className="flex items-center gap-2 text-sm text-ink">
                          <span className="text-brand" aria-hidden="true">
                            <IconCheck size={14} />
                          </span>
                          Copies{" "}
                          <strong className="font-semibold">{pickedSource.name}</strong>
                          {pickedSource.resolver_id === Number(resolverId) ? (
                            <span className="text-ink-dim">
                              · {resolver?.name ?? `resolver #${pickedSource.resolver_id}`}
                            </span>
                          ) : null}
                        </p>
                        <JsonView value={pickedSource.resolver_config ?? {}} label="Config" />
                        <p className="text-ink-dim" style={{ fontSize: "var(--fs-sm)" }}>
                          The profile keeps its own copy — switch to “Pick a resolver” to edit the values.
                        </p>
                      </div>
                    )}
                  </>
                )}
              </TabPanel>
            </FormBlock>

            <FormBlock step="4" title="Retry" hint="optional">
              {engine === undefined ? (
                <p className="text-ink-dim" style={{ fontSize: "var(--fs-sm)" }}>
                  Pick an engine first — retry modes are declared by the engine.
                </p>
              ) : retryModeKeys.length === 0 ? (
                <p className="text-ink-dim" style={{ fontSize: "var(--fs-sm)" }}>
                  This engine declares no retry modes.
                </p>
              ) : (
                <>
                  <Field label="Mode" htmlFor="preset-profile-retry-mode" error={fieldErrors.retry_mode ?? null}>
                    <Select
                      id="preset-profile-retry-mode"
                      value={retryMode}
                      onChange={(event) => changeRetryMode(event.target.value)}
                    >
                      <option value="">No retry</option>
                      {retryModeKeys.map((key) => (
                        <option key={key} value={key}>
                          {humanize(key)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {retryMode !== "" ? (
                    <SchemaForm
                      schema={retrySchema}
                      value={retryConfig}
                      onChange={setRetryConfig}
                      idPrefix="preset-profile-retry-config"
                    />
                  ) : null}
                  {fieldErrors.retry_config !== undefined ? (
                    <span className="flex items-center gap-1 text-sm text-danger" role="alert">
                      {fieldErrors.retry_config}
                    </span>
                  ) : null}
                </>
              )}
            </FormBlock>
          </form>
        ) : (
          <form id={SOURCE_FORM_ID} className="flex flex-col gap-4" onSubmit={submitSource}>
            {error !== null ? <Banner kind="danger" title={error} /> : null}

            <FormBlock step="1" title="Identity">
              <Field
                label="Name"
                htmlFor="preset-source-name"
                required
                error={
                  duplicateSourceName
                    ? "A source with this name already exists."
                    : (fieldErrors.name ?? null)
                }
                hint="Pick it by name wherever a resolver asks for a config."
              >
                <Input
                  id="preset-source-name"
                  value={sourceName}
                  autoComplete="off"
                  placeholder="e.g. sky-sports-main"
                  onChange={(event) => setSourceName(event.target.value)}
                />
              </Field>
            </FormBlock>

            <FormBlock step="2" title="Resolver" hint="saved with the config">
              <Field label="Resolver" htmlFor="preset-source-resolver" required error={fieldErrors.resolver_id ?? null}>
                <Select
                  id="preset-source-resolver"
                  value={sourceResolverId}
                  onChange={(event) => changeSourceResolver(event.target.value)}
                >
                  <option value="">Select a resolver…</option>
                  {resolvers.map((item) => (
                    <option key={item.id} value={String(item.id)}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </Field>

              {canBrowse ? (
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    icon={<IconSearch size={15} />}
                    onClick={() => setBrowseOpen(true)}
                  >
                    Browse {sourceResolver.name}…
                  </Button>
                </div>
              ) : null}

              <section className="flex flex-col gap-2">
                <h4 className={panelTitleClass}>Resolver config</h4>
                {schemasLoading ? (
                  <SkeletonRows rows={3} cols={2} />
                ) : sourceResolver === undefined ? (
                  <p className="text-ink-dim" style={{ fontSize: "var(--fs-sm)" }}>
                    Pick a resolver to configure it.
                  </p>
                ) : (
                  <SchemaForm
                    schema={sourceResolver.config_schema}
                    value={sourceConfig}
                    onChange={setSourceConfig}
                    idPrefix="preset-source-resolver-config"
                  />
                )}
                {fieldErrors.resolver_config !== undefined ? (
                  <span className="flex items-center gap-1 text-sm text-danger" role="alert">
                    {fieldErrors.resolver_config}
                  </span>
                ) : null}
              </section>
            </FormBlock>
          </form>
        )}
      </TabPanel>

      <DiscoveryDrawer
        open={browseOpen}
        onClose={() => setBrowseOpen(false)}
        resolver={sourceResolver ?? null}
        onUse={(item) => {
          setSourceConfig(item.config ?? {})
          setBrowseOpen(false)
        }}
      />
    </Dialog>
  )
}
