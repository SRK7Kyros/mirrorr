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
import { cn } from "@/ui/lib/cn"
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
import { DiscoveryDrawer, canBrowseResolver } from "@/ui/views/shared/discovery-drawer"
import {
  AccessCreation,
  useCreationAccessApplier,
} from "@/ui/views/shared/resource-access-slot"
import type { AccessTarget } from "@/api/domain/access-plan"

/**
 * The create/edit dialog for both things the Presets page holds.
 *
 * A profile is a whole recording setup (engine + resolver config + retry
 * policy); a source is only the saved `(resolver_id, resolver_config)` pair.
 * They used to be two dialogs behind two floating "+" buttons stacked in the
 * same corner, so on touch layouts the source one always won the tap and a
 * profile could not be created at all. Now the phone's single "+" opens this
 * dialog and picks the kind from a segmented switcher; a section button
 * (`allowKindSwitch` false) already says what it makes, so it opens straight
 * into that kind's form.
 *
 * The profile body separates the two ways its resolver config can arrive. Both
 * used to be live at once — a resolver picker *and* a "load from a saved
 * source" picker, either of which silently overwrote the other — so the *Source*
 * block opens with a mode control ("Pick a resolver" / "Use a saved source") and
 * only the chosen mode's controls are rendered. Switching to "Pick a resolver"
 * keeps whatever the saved source copied in, so the copy stays editable; only
 * the *link* to the source is dropped.
 *
 * Blocks read in the order the work happens — Identity, Source, Engine & retry:
 * the resolver decides *what* is recorded, the engine only *how*, and the retry
 * group (whose modes the engine declares) stays inert until one is chosen.
 */

export type PresetKind = "profile" | "source"

/** Where the profile's resolver config comes from — exactly one of the two. */
type ResolverMode = "resolver" | "source"

export interface PresetsDialogProps {
  readonly open: boolean
  /** Which tab opens first; also the kind being edited. */
  readonly kind: PresetKind
  /**
   * Whether the kind may be chosen here. True for the phone's "+", which is the
   * only create entry there; false for a section button, whose label already
   * says what it makes.
   */
  readonly allowKindSwitch: boolean
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

/** The kind tab panel when the switcher is on screen, a plain group when not. */
function FormPanel({
  switcher,
  active,
  children,
}: {
  readonly switcher: boolean
  readonly active: PresetKind
  readonly children: ReactNode
}) {
  if (!switcher) return <div className="flex flex-col gap-4">{children}</div>
  return (
    <TabPanel panelId="preset-kind" active={active} className="flex flex-col gap-4">
      {children}
    </TabPanel>
  )
}

export function PresetsDialog({ open, kind, allowKindSwitch, profile, source, onClose }: PresetsDialogProps) {
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
  /** Which body asked for the overlay — one overlay, one config target. */
  const [browseTarget, setBrowseTarget] = useState<"profile" | "source" | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({})
  const [access, setAccess] = useState<AccessTarget>({})
  const applyCreation = useCreationAccessApplier()

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
    setBrowseTarget(null)
    setError(null)
    setFieldErrors({})
    setAccess({})
  }, [open, kind, profile, source])

  const saveProfile = useMutation({
    mutationFn: async (body: ProfileBody) => {
      if (profile !== null) return updateProfile(profile.id, body)
      const created = await createProfile(body)
      if (applyCreation === null) return created
      try {
        await applyCreation("profile", created.id, access)
      } catch (caught) {
        toast.error(
          "Profile created, but its access was not set",
          getErrorMessage(caught, "Could not set access"),
        )
      }
      return created
    },
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
    mutationFn: async (body: SourceBody) => {
      if (source !== null) return updateSource(source.id, body)
      const created = await createSource(body)
      if (applyCreation === null) return created
      try {
        await applyCreation("source", created.id, access)
      } catch (caught) {
        toast.error(
          "Source created, but its access was not set",
          getErrorMessage(caught, "Could not set access"),
        )
      }
      return created
    },
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
  const canBrowse = canBrowseResolver(sourceResolver)
  // The profile body gets the same panel: a resolver that declares discovery has
  // a catalog to browse wherever it is configured.
  const canBrowseProfile = canBrowseResolver(resolver)

  const editing = tab === "profile" ? profile !== null : source !== null
  // The kind switcher is a phone affordance: there the "+" is the only create
  // entry, while a section button on a wide screen is scoped to its own kind.
  const switcher = !editing && allowKindSwitch
  const noun = tab === "profile" ? "profile" : "source"

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
    // The engine's mode list is the whole truth: every set of `retry_modes`
    // declares `none`, which is what the backend itself falls back to
    // (`config.get("mode", "none")`), so seed that rather than carrying a second
    // "no retry" state the API does not have.
    const modes = asObject(engines.find((item) => String(item.id) === nextId)?.retry_modes_schema)
    const keys = Object.keys(modes)
    const seeded = keys.includes("none") ? "none" : (keys[0] ?? "")
    setRetryMode(seeded)
    setRetryConfig(asObject(asObject(modes[seeded])["default_params"]))
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
      title={editing ? `Edit ${noun}` : switcher ? "New preset" : `New ${noun}`}
      description={
        editing
          ? tab === "profile"
            ? "Change its engine, resolver config or retry policy."
            : "Change the resolver and the config saved with it."
          : switcher
            ? "A profile is a complete recording setup — engine, resolver config and retry policy. A source is just a saved resolver config."
            : tab === "profile"
              ? "A complete recording setup — resolver config, engine and retry policy."
              : "A saved resolver config, reusable wherever a resolver asks for one."
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
      {switcher ? (
        <Field label="Type">
          <Segmented
            className="self-start"
            ariaLabel="Preset type"
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

      <FormPanel switcher={switcher} active={tab}>
        {tab === "profile" ? (
          <form id={PROFILE_FORM_ID} className="flex flex-col gap-4" onSubmit={submitProfile}>
            {error !== null ? <Banner kind="danger" title={error} /> : null}

            <FormBlock step="1" title="Identity" hint="what it's called">
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

            <FormBlock
              step="2"
              title="Resolver"
              hint="how the stream is found"
            >
              <Field label="Config source">
                <Segmented
                  className="self-start"
                  ariaLabel="Config source"
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

                    {canBrowseProfile ? (
                      <div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          icon={<IconSearch size={15} />}
                          onClick={() => setBrowseTarget("profile")}
                        >
                          Browse {resolver.name}…
                        </Button>
                      </div>
                    ) : null}

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

                    <section className="flex flex-col gap-2">
                      <h4 className={panelTitleClass}>Resolver config</h4>
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
                    </section>
                  </>
                )}
              </TabPanel>
            </FormBlock>

            <FormBlock step="3" title="Engine & retry" hint="how it's recorded">
              <Field
                label="Engine"
                htmlFor="preset-profile-engine"
                required
                error={fieldErrors.default_engine_id ?? fieldErrors.engine_id ?? null}
                hint={engine === undefined ? "Engines come from the installed plugins." : undefined}
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

              {/* Inert until an engine is chosen: the modes belong to the engine,
                  so there is nothing to pick before then. */}
              <section
                className={cn(
                  "flex flex-col gap-3 border-t border-line-subtle pt-4",
                  engine === undefined && "opacity-45",
                )}
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <h4 className={panelTitleClass}>Retry</h4>
                  <span className="text-sm text-ink-dim">
                    {engine === undefined
                      ? "pick an engine first"
                      : retryModeKeys.length === 0
                        ? "this engine declares no retry modes"
                        : "optional"}
                  </span>
                </div>
                <Field label="Mode" htmlFor="preset-profile-retry-mode" error={fieldErrors.retry_mode ?? null}>
                  <Select
                    id="preset-profile-retry-mode"
                    value={retryMode}
                    disabled={engine === undefined || retryModeKeys.length === 0}
                    onChange={(event) => changeRetryMode(event.target.value)}
                  >
                    {/* Not a mode of its own: shown only when the value cannot be
                        one — an engine that declares nothing, or a stored mode this
                        engine no longer lists. "none" is a real mode of the schema. */}
                    {retryModeKeys.includes(retryMode) ? null : (
                      <option value={retryMode}>
                        {retryMode === "" ? "\u2014" : `${humanize(retryMode)} (unavailable)`}
                      </option>
                    )}
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
              </section>
            </FormBlock>
          </form>
        ) : (
          <form id={SOURCE_FORM_ID} className="flex flex-col gap-4" onSubmit={submitSource}>
            {error !== null ? <Banner kind="danger" title={error} /> : null}

            <FormBlock step="1" title="Identity" hint="what it's called">
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

            <FormBlock step="2" title="Resolver" hint="how the stream is found">
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
                    onClick={() => setBrowseTarget("source")}
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
      </FormPanel>

      {editing ? null : (
        <AccessCreation
          key={tab}
          resourceType={tab === "profile" ? "profile" : "source"}
          onChange={setAccess}
          busy={pending}
        />
      )}

      <DiscoveryDrawer
        open={browseTarget !== null}
        onClose={() => setBrowseTarget(null)}
        resolver={(browseTarget === "source" ? sourceResolver : resolver) ?? null}
        onUse={(item) => {
          if (browseTarget === "source") setSourceConfig(item.config ?? {})
          else setResolverConfig(item.config ?? {})
          setBrowseTarget(null)
        }}
      />
    </Dialog>
  )
}
