import { useMemo, type FormEvent } from "react"
import type { Engine, Profile, Resolver, ResolverSource } from "@/api/schemas"
import {
  type ChainBase,
  type ChainCatalog,
  type FallbackRung,
} from "@/api/domain/fallback-chain"
import {
  asObject,
  Banner,
  Button,
  Field,
  IconCheck,
  IconSearch,
  Input,
  JsonView,
  SchemaForm,
  Segmented,
  Select,
  TabPanel,
  panelTitleClass,
  type QueryLike,
} from "@/ui/components"
import { humanize } from "@/ui/lib/format"
import { cn } from "@/ui/lib/cn"
import { ChainEditor } from "@/ui/views/shared/chain-editor"
import { canBrowseResolver } from "@/ui/views/shared/discovery-drawer"
import { CatalogEmpty, CatalogGate, CatalogSkeleton, FormBlock } from "./presets-dialog-blocks"
import type { ResolverMode } from "./presets-dialog-dirty"

/**
 * The two bodies of the preset editor.
 *
 * They are pure views over state the dialog owns: every value arrives as a
 * prop and every edit leaves through a callback, so the dirty model has exactly
 * one source of truth. The three blocks stay in one scrollable body, in the
 * order the work happens — what it is called, where the stream comes from,
 * when it needs another go. No wizard: a profile is short enough to see whole.
 */

export interface ProfileFormValues {
  readonly name: string
  readonly engineId: string
  readonly resolverId: string
  readonly resolverConfig: Readonly<Record<string, unknown>>
  readonly retryMode: string
  readonly retryConfig: Readonly<Record<string, unknown>>
  readonly chain: readonly FallbackRung[]
  readonly mode: ResolverMode
  readonly pickedSourceId: string
}

export interface ProfileFormActions {
  readonly onName: (value: string) => void
  readonly onEngine: (value: string) => void
  readonly onResolver: (value: string) => void
  readonly onResolverConfig: (value: Record<string, unknown>) => void
  readonly onRetryMode: (value: string) => void
  readonly onRetryConfig: (value: Record<string, unknown>) => void
  readonly onChain: (value: FallbackRung[]) => void
  readonly onMode: (value: ResolverMode) => void
  readonly onPickSource: (value: string) => void
  readonly onBrowse: () => void
}

/** The lookup lists every form reads, with their own query state (`CMP-08`). */
export interface PresetCatalogs {
  readonly engines: readonly Engine[]
  readonly enginesQuery: QueryLike
  readonly resolvers: readonly Resolver[]
  readonly resolversQuery: QueryLike
  readonly sources: readonly ResolverSource[]
  readonly sourcesQuery: QueryLike
  readonly profiles: readonly Profile[]
  readonly profilesQuery: QueryLike
}

export interface ProfileFormProps {
  readonly formId: string
  readonly values: ProfileFormValues
  readonly actions: ProfileFormActions
  readonly catalogs: PresetCatalogs
  readonly base: ChainBase | null
  readonly fieldErrors: Readonly<Record<string, string>>
  /** Name clash, or a failed name check — shown on the field. */
  readonly nameError: string | null
  readonly error: string | null
  readonly pending: boolean
  readonly onRetryProfiles: () => void
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

export function ProfileForm({
  formId,
  values,
  actions,
  catalogs,
  base,
  fieldErrors,
  nameError,
  error,
  pending,
  onRetryProfiles,
  onSubmit,
}: ProfileFormProps) {
  const engine = catalogs.engines.find((item) => String(item.id) === values.engineId)
  const resolver = catalogs.resolvers.find((item) => String(item.id) === values.resolverId)
  const pickedSource = catalogs.sources.find((item) => String(item.id) === values.pickedSourceId)
  const retryModes = asObject(engine?.retry_modes_schema)
  const retryModeKeys = Object.keys(retryModes)
  const retrySchema = asObject(asObject(retryModes[values.retryMode])["schema"])
  const catalog = useMemo<ChainCatalog>(
    () => ({ profiles: catalogs.profiles, engines: catalogs.engines, resolvers: catalogs.resolvers }),
    [catalogs.profiles, catalogs.engines, catalogs.resolvers],
  )
  // A failed saved-source list is not an empty one: leave the mode reachable so
  // its error panel and Retry can be seen, and only call it empty once we know.
  const noSavedSources =
    catalogs.sources.length === 0 &&
    catalogs.sourcesQuery.isLoading !== true &&
    catalogs.sourcesQuery.isError !== true

  return (
    <form id={formId} className="flex flex-col gap-4" onSubmit={onSubmit}>
      {error !== null ? <Banner kind="danger" title={error} /> : null}
      {catalogs.profilesQuery.isError === true ? (
        <Banner
          kind="warning"
          title="Could not check existing profile names"
          action={
            <Button size="sm" variant="outline" onClick={onRetryProfiles}>
              Retry
            </Button>
          }
        >
          A duplicate may be rejected when you save.
        </Banner>
      ) : null}

      <FormBlock step="1" title="Identity" hint="what it's called">
        <Field
          label="Name"
          htmlFor="preset-profile-name"
          required
          error={nameError ?? fieldErrors.name ?? null}
          hint="How it is listed in the session and autorun pickers."
        >
          <Input
            id="preset-profile-name"
            value={values.name}
            autoComplete="off"
            placeholder="e.g. nightly-news"
            onChange={(event) => actions.onName(event.target.value)}
          />
        </Field>
      </FormBlock>

      <FormBlock step="2" title="Source & engine" hint="where the stream comes from">
        <CatalogGate
          query={catalogs.enginesQuery}
          errorMessage="Could not load the engines"
          isEmpty={catalogs.engines.length === 0}
          loadingLabel="Loading engines"
          empty={
            <CatalogEmpty>
              No engines are installed — an engine comes from a plugin enabled on Plugins.
            </CatalogEmpty>
          }
        >
          <Field
            label="Engine"
            htmlFor="preset-profile-engine"
            required
            error={fieldErrors.default_engine_id ?? fieldErrors.engine_id ?? null}
            hint={engine === undefined ? "Engines come from the installed plugins." : undefined}
          >
            <Select
              id="preset-profile-engine"
              value={values.engineId}
              onChange={(event) => actions.onEngine(event.target.value)}
            >
              <option value="">Select an engine…</option>
              {catalogs.engines.map((item) => (
                <option key={item.id} value={String(item.id)}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Field>
        </CatalogGate>

        <Field label="Config source">
          <Segmented
            className="self-start"
            ariaLabel="Config source"
            panelId="preset-resolver-mode"
            active={values.mode}
            onChange={actions.onMode}
            items={[
              { id: "resolver", label: "Pick a resolver" },
              { id: "source", label: "Use a saved source", disabled: noSavedSources },
            ]}
          />
        </Field>

        <TabPanel panelId="preset-resolver-mode" active={values.mode} className="flex flex-col gap-4">
          {values.mode === "resolver" ? (
            <ResolverModeBody
              values={values}
              actions={actions}
              catalogs={catalogs}
              resolver={resolver}
              fieldErrors={fieldErrors}
            />
          ) : (
            <SavedSourceBody
              values={values}
              actions={actions}
              catalogs={catalogs}
              pickedSource={pickedSource}
              fieldErrors={fieldErrors}
            />
          )}
        </TabPanel>

        {base === null ? null : (
          <ChainEditor
            idPrefix="preset-profile"
            catalog={catalog}
            base={base}
            value={values.chain}
            onChange={actions.onChain}
            disabled={pending}
            subject="profile"
          />
        )}
      </FormBlock>

      <FormBlock step="3" title="Retry" hint="when it needs another go">
        {/* Inert until an engine is chosen: the modes belong to the engine, so
            there is nothing to pick before then. */}
        <section className={cn("flex flex-col gap-3", engine === undefined && "opacity-45")}>
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
              value={values.retryMode}
              disabled={engine === undefined || retryModeKeys.length === 0}
              onChange={(event) => actions.onRetryMode(event.target.value)}
            >
              {/* Not a mode of its own: shown only when the value cannot be one —
                  an engine that declares nothing, or a stored mode this engine no
                  longer lists. "none" is a real mode of the schema. */}
              {retryModeKeys.includes(values.retryMode) ? null : (
                <option value={values.retryMode}>
                  {values.retryMode === "" ? "\u2014" : `${humanize(values.retryMode)} (unavailable)`}
                </option>
              )}
              {retryModeKeys.map((key) => (
                <option key={key} value={key}>
                  {humanize(key)}
                </option>
              ))}
            </Select>
          </Field>
          {values.retryMode !== "" ? (
            <SchemaForm
              schema={retrySchema}
              value={values.retryConfig}
              onChange={actions.onRetryConfig}
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
  )
}

interface ResolverModeBodyProps {
  readonly values: ProfileFormValues
  readonly actions: ProfileFormActions
  readonly catalogs: PresetCatalogs
  readonly resolver: Resolver | undefined
  readonly fieldErrors: Readonly<Record<string, string>>
}

function ResolverModeBody({ values, actions, catalogs, resolver, fieldErrors }: ResolverModeBodyProps) {
  return (
    <>
      <CatalogGate
        query={catalogs.resolversQuery}
        errorMessage="Could not load the resolvers"
        isEmpty={catalogs.resolvers.length === 0}
        loadingLabel="Loading resolvers"
        empty={
          <CatalogEmpty>
            No resolvers are installed — a resolver comes from a plugin enabled on Plugins.
          </CatalogEmpty>
        }
      >
        <Field
          label="Resolver"
          htmlFor="preset-profile-resolver"
          required
          error={fieldErrors.resolver_id ?? null}
        >
          <Select
            id="preset-profile-resolver"
            value={values.resolverId}
            onChange={(event) => actions.onResolver(event.target.value)}
          >
            <option value="">Select a resolver…</option>
            {catalogs.resolvers.map((item) => (
              <option key={item.id} value={String(item.id)}>
                {item.name}
              </option>
            ))}
          </Select>
        </Field>
      </CatalogGate>

      {canBrowseResolver(resolver) ? (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            icon={<IconSearch size={15} />}
            onClick={actions.onBrowse}
          >
            Browse {resolver.name}…
          </Button>
        </div>
      ) : null}

      <ResolverConfigSection
        idPrefix="preset-profile-resolver-config"
        resolver={resolver}
        loading={catalogs.resolversQuery.isLoading === true}
        config={values.resolverConfig}
        onChange={actions.onResolverConfig}
        error={fieldErrors.resolver_config ?? null}
      />
    </>
  )
}

interface SavedSourceBodyProps {
  readonly values: ProfileFormValues
  readonly actions: ProfileFormActions
  readonly catalogs: PresetCatalogs
  readonly pickedSource: ResolverSource | undefined
  readonly fieldErrors: Readonly<Record<string, string>>
}

function SavedSourceBody({ values, actions, catalogs, pickedSource, fieldErrors }: SavedSourceBodyProps) {
  const copiedResolver =
    pickedSource === undefined
      ? ""
      : (catalogs.resolvers.find((item) => item.id === pickedSource.resolver_id)?.name ??
        `resolver #${pickedSource.resolver_id}`)
  return (
    <>
      <CatalogGate
        query={catalogs.sourcesQuery}
        errorMessage="Could not load the saved sources"
        isEmpty={catalogs.sources.length === 0}
        loadingLabel="Loading saved sources"
        empty={<CatalogEmpty>No saved sources yet — create one from the Sources section.</CatalogEmpty>}
      >
        <Field
          label="Saved source"
          htmlFor="preset-profile-source"
          required
          error={fieldErrors.resolver_id ?? null}
        >
          <Select
            id="preset-profile-source"
            value={values.pickedSourceId}
            onChange={(event) => actions.onPickSource(event.target.value)}
          >
            <option value="">Pick a saved source…</option>
            {catalogs.sources.map((item) => (
              <option key={item.id} value={String(item.id)}>
                {item.name}
              </option>
            ))}
          </Select>
        </Field>
      </CatalogGate>

      <section className="flex flex-col gap-2">
        <h4 className={panelTitleClass}>Resolver config</h4>
        {pickedSource === undefined ? (
          <p className="text-sm text-ink-dim">Pick a source to see what it fills in.</p>
        ) : (
          <div className="flex flex-col gap-3 rounded-sm border border-[var(--accent-line)] bg-[var(--accent-dim)] p-3">
            <p className="flex items-center gap-2 text-sm text-ink">
              <span className="text-brand" aria-hidden="true">
                <IconCheck size={14} />
              </span>
              Copies <strong className="font-semibold">{pickedSource.name}</strong>
              {pickedSource.resolver_id === Number(values.resolverId) ? (
                <span className="text-ink-dim">· {copiedResolver}</span>
              ) : null}
            </p>
            <JsonView value={pickedSource.resolver_config ?? {}} label="Config" />
            <p className="text-sm text-ink-dim">
              The profile keeps its own copy — switch to “Pick a resolver” to edit the values.
            </p>
          </div>
        )}
      </section>
    </>
  )
}

/** Resolver config, in whatever shape the chosen resolver declares. */
export function ResolverConfigSection({
  idPrefix,
  resolver,
  loading,
  config,
  onChange,
  error,
}: {
  readonly idPrefix: string
  readonly resolver: Resolver | undefined
  readonly loading: boolean
  readonly config: Readonly<Record<string, unknown>>
  readonly onChange: (value: Record<string, unknown>) => void
  readonly error: string | null
}) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className={panelTitleClass}>Resolver config</h4>
      {loading ? (
        <CatalogSkeleton label="Loading resolver config" />
      ) : resolver === undefined ? (
        <p className="text-sm text-ink-dim">Pick a resolver to configure it.</p>
      ) : (
        <SchemaForm
          schema={resolver.config_schema}
          value={config}
          onChange={onChange}
          idPrefix={idPrefix}
        />
      )}
      {error !== null ? (
        <span className="flex items-center gap-1 text-sm text-danger" role="alert">
          {error}
        </span>
      ) : null}
    </section>
  )
}

export interface SourceFormValues {
  readonly name: string
  readonly resolverId: string
  readonly resolverConfig: Readonly<Record<string, unknown>>
}

export interface SourceFormActions {
  readonly onName: (value: string) => void
  readonly onResolver: (value: string) => void
  readonly onResolverConfig: (value: Record<string, unknown>) => void
  readonly onBrowse: () => void
}

export interface SourceFormProps {
  readonly formId: string
  readonly values: SourceFormValues
  readonly actions: SourceFormActions
  readonly catalogs: PresetCatalogs
  readonly fieldErrors: Readonly<Record<string, string>>
  readonly nameError: string | null
  readonly error: string | null
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

export function SourceForm({
  formId,
  values,
  actions,
  catalogs,
  fieldErrors,
  nameError,
  error,
  onSubmit,
}: SourceFormProps) {
  const resolver = catalogs.resolvers.find((item) => String(item.id) === values.resolverId)
  return (
    <form id={formId} className="flex flex-col gap-4" onSubmit={onSubmit}>
      {error !== null ? <Banner kind="danger" title={error} /> : null}

      <FormBlock step="1" title="Identity" hint="what it's called">
        <Field
          label="Name"
          htmlFor="preset-source-name"
          required
          error={nameError ?? fieldErrors.name ?? null}
          hint="Pick it by name wherever a resolver asks for a config."
        >
          <Input
            id="preset-source-name"
            value={values.name}
            autoComplete="off"
            placeholder="e.g. sky-sports-main"
            onChange={(event) => actions.onName(event.target.value)}
          />
        </Field>
      </FormBlock>

      <FormBlock step="2" title="Resolver" hint="how the stream is found">
        <CatalogGate
          query={catalogs.resolversQuery}
          errorMessage="Could not load the resolvers"
          isEmpty={catalogs.resolvers.length === 0}
          loadingLabel="Loading resolvers"
          empty={
            <CatalogEmpty>
              No resolvers are installed — a resolver comes from a plugin enabled on Plugins.
            </CatalogEmpty>
          }
        >
          <Field
            label="Resolver"
            htmlFor="preset-source-resolver"
            required
            error={fieldErrors.resolver_id ?? null}
          >
            <Select
              id="preset-source-resolver"
              value={values.resolverId}
              onChange={(event) => actions.onResolver(event.target.value)}
            >
              <option value="">Select a resolver…</option>
              {catalogs.resolvers.map((item) => (
                <option key={item.id} value={String(item.id)}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Field>
        </CatalogGate>

        {canBrowseResolver(resolver) ? (
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              icon={<IconSearch size={15} />}
              onClick={actions.onBrowse}
            >
              Browse {resolver.name}…
            </Button>
          </div>
        ) : null}

        <ResolverConfigSection
          idPrefix="preset-source-resolver-config"
          resolver={resolver}
          loading={catalogs.resolversQuery.isLoading === true}
          config={values.resolverConfig}
          onChange={actions.onResolverConfig}
          error={fieldErrors.resolver_config ?? null}
        />
      </FormBlock>
    </form>
  )
}
