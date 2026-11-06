import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ApiError,
  createProfile,
  createSource,
  getErrorMessage,
  updateProfile,
  updateSource,
  type ProfileBody,
  type SourceBody,
} from "@/api"
import {
  fetchAllEngines,
  fetchAllResolvers,
  fetchProfilePage,
  fetchSourcePage,
} from "@/api/endpoints"
import { fetchAllLookupPages, queryKeys, queryRoots, staleTimes } from "@/api/query-keys"
import type { Engine, Profile, Resolver, ResolverSource } from "@/api/schemas"
import type { AccessTarget } from "@/api/domain/access-plan"
import {
  asObject,
  Button,
  ConfirmDialog,
  defaultsFromSchema,
  Dialog,
  Segmented,
  toast,
} from "@/ui/components"
import { DiscoveryDrawer } from "@/ui/views/shared/discovery-drawer"
import { AccessCreation, useCreationAccessApplier } from "@/ui/views/shared/resource-access-slot"
import {
  chainProblemSentence,
  normaliseRung,
  pruneChain,
  resolveChain,
  sameChain,
  type ChainBase,
  type ChainCatalog,
  type FallbackRung,
} from "@/api/domain/fallback-chain"
import { BodyTail, FormPanel } from "./presets-dialog-blocks"
import { ProfileForm, SourceForm, type ProfileFormActions, type SourceFormActions } from "./presets-dialog-forms"
import {
  changedFields,
  discardSentence,
  draftFrom,
  EMPTY_DRAFT,
  type PresetDraftState,
  type PresetKind,
  type ResolverMode,
} from "./presets-dialog-dirty"

export type { PresetKind } from "./presets-dialog-dirty"

/**
 * The create/edit dialog for both things the Profiles page holds.
 *
 * A profile is a whole recording setup (engine + resolver config + retry
 * policy); a source is only the saved `(resolver_id, resolver_config)` pair.
 * They used to be two dialogs behind two floating "+" buttons stacked in the
 * same corner, so on touch layouts the source one always won the tap and a
 * profile could not be created at all. Now the page's own buttons open this
 * dialog scoped to the kind they name; a build that hands the phone's single
 * "+" here keeps the segmented kind switcher.
 *
 * Three things are the point of this rewrite:
 *
 * 1. **Nothing typed is discarded without a word** (`PRE-02`, `FLW-07`). Every
 *    close path — scrim, Escape, Cancel, the X, switching kind — goes through
 *    `requestClose`, which asks "Discard changes?" and names the fields that
 *    differ from what the dialog opened with. An untouched dialog closes
 *    straight away, and a saved one closes without asking.
 * 2. **A failed catalog never reads as an empty one** (`CMP-08`). Engines,
 *    resolvers and saved sources each render loading → error + Retry → empty
 *    prose, and a failed list the form needs also disables the primary with a
 *    reason that names it.
 * 3. **The footer does not sit on the last field on a phone** (`PRE-07`): the
 *    body carries a footer's worth of headroom and scroll margin.
 *
 * The profile body separates the two ways its resolver config can arrive —
 * a resolver picker *or* a saved source, never both live at once.
 */

export interface PresetsDialogProps {
  readonly open: boolean
  /** Which tab opens first; also the kind being edited. */
  readonly kind: PresetKind
  /**
   * Whether the kind may be chosen here. True for a phone's "+", which is the
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
const REASON_ID = "preset-submit-reason"

const NO_ENGINES: readonly Engine[] = []
const NO_RESOLVERS: readonly Resolver[] = []
const NO_PROFILES: readonly Profile[] = []
const NO_SOURCES: readonly ResolverSource[] = []

/** Which failed list stops the save — named, because "disabled" alone teaches nothing. */
export function catalogBlockReason(
  enginesFailed: boolean,
  resolversFailed: boolean,
): string | null {
  if (enginesFailed) return "The engine list did not load — retry it above before saving."
  if (resolversFailed) return "The resolver list did not load — retry it above before saving."
  return null
}

/** Every close path lands here: ask first when there is something to lose. */
export function PresetsDialog({
  open,
  kind,
  allowKindSwitch,
  profile,
  source,
  onClose,
}: PresetsDialogProps) {
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
  // Full lists, not a panel's loaded page — duplicate names are checked against
  // everything that exists. Same query keys as the lookup hooks, so the dialog
  // adds no request; having the query object is what lets a failure be shown.
  const profilesQuery = useQuery({
    queryKey: queryKeys.profiles({ lookup: true }),
    queryFn: () => fetchAllLookupPages((cursor) => fetchProfilePage(cursor)),
    staleTime: staleTimes.lookup,
  })
  const sourcesQuery = useQuery({
    queryKey: queryKeys.sources({ lookup: true }),
    queryFn: () => fetchAllLookupPages((cursor) => fetchSourcePage(cursor)),
    staleTime: staleTimes.lookup,
  })

  const engines = enginesQuery.data ?? NO_ENGINES
  const resolvers = resolversQuery.data ?? NO_RESOLVERS
  const profiles = profilesQuery.data ?? NO_PROFILES
  const sources = sourcesQuery.data ?? NO_SOURCES

  const [tab, setTab] = useState<PresetKind>(kind)

  // Profile body
  const [name, setName] = useState("")
  const [engineId, setEngineId] = useState("")
  const [resolverId, setResolverId] = useState("")
  const [resolverConfig, setResolverConfig] = useState<Record<string, unknown>>({})
  const [retryMode, setRetryMode] = useState("")
  const [retryConfig, setRetryConfig] = useState<Record<string, unknown>>({})
  const [chain, setChain] = useState<FallbackRung[]>([])
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

  /** What the dialog opened with; the dirty model is the difference from here. */
  const [initial, setInitial] = useState<PresetDraftState>(EMPTY_DRAFT)
  /** Which close was interrupted by "Discard changes?", if any. */
  const [discard, setDiscard] = useState<PresetKind | "close" | null>(null)

  const resetDraft = useCallback(() => {
    const next = draftFrom(profile, source)
    setName(next.profile.name)
    setEngineId(next.profile.engineId)
    setResolverId(next.profile.resolverId)
    setResolverConfig({ ...next.profile.resolverConfig })
    setRetryMode(next.profile.retryMode)
    setRetryConfig({ ...next.profile.retryConfig })
    setChain([...next.profile.chain])
    setMode("resolver")
    setPickedSourceId("")
    setSourceName(next.source.name)
    setSourceResolverId(next.source.resolverId)
    setSourceConfig({ ...next.source.resolverConfig })
    setAccess({})
    setInitial(next)
    setBrowseTarget(null)
    setError(null)
    setFieldErrors({})
    setDiscard(null)
  }, [profile, source])

  // Reset the whole dialog each time it opens — create after create, or a
  // different row. `profile`/`source` identity is stable while it is open.
  useEffect(() => {
    if (!open) return
    setTab(kind)
    resetDraft()
  }, [open, kind, resetDraft])

  const base = useMemo<ChainBase | null>(() => {
    if (engineId === "" || resolverId === "") return null
    return {
      engine_id: Number(engineId),
      resolver_id: Number(resolverId),
      resolver_config: resolverConfig,
      retry_mode: retryMode === "" ? "none" : retryMode,
      retry_config: retryConfig,
      ...(profile === null ? {} : { profile_id: profile.id, profile_name: profile.name }),
    }
  }, [engineId, resolverId, resolverConfig, retryMode, retryConfig, profile])

  const catalog = useMemo<ChainCatalog>(
    () => ({ profiles, engines, resolvers }),
    [profiles, engines, resolvers],
  )

  // Editing the profile's own capture can turn a rung into a repeat of it; the
  // chain travels with the source it was written against.
  useEffect(() => {
    if (base === null) return
    setChain((previous) => {
      const next = pruneChain(previous, base, catalog)
      return sameChain(next, previous) ? previous : next
    })
  }, [base, catalog])

  const chainState = base === null ? null : resolveChain(chain, base, catalog)
  const chainTrouble = chainState === null ? null : chainState.problem

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
      // Saved, so there is nothing left to guard: close without asking.
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

  const sourceResolver = resolvers.find((item) => String(item.id) === sourceResolverId)

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
    if (chainTrouble !== null) {
      // The disabled button does not stop Enter in a text field.
      setError(chainProblemSentence(chainTrouble, "profile"))
      return
    }
    saveProfile.mutate({
      name: name.trim(),
      default_engine_id: Number(engineId),
      resolver_id: Number(resolverId),
      resolver_config: resolverConfig,
      fallback_chain: chain.map(normaliseRung),
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

  // `blockedReason` names what stops the save, in the footer beside the button.
  const blockedReason =
    catalogBlockReason(
      tab === "profile" && enginesQuery.isError,
      resolversQuery.isError,
    ) ?? (tab === "profile" && chainTrouble !== null ? chainProblemSentence(chainTrouble, "profile") : null)

  const submitDisabled =
    blockedReason !== null ||
    (tab === "profile" ? duplicateName || name.trim() === "" : duplicateSourceName || sourceName.trim() === "")

  const draft = useMemo<PresetDraftState>(
    () => ({
      profile: { name, engineId, resolverId, resolverConfig, retryMode, retryConfig, chain },
      source: { name: sourceName, resolverId: sourceResolverId, resolverConfig: sourceConfig },
      access,
    }),
    [name, engineId, resolverId, resolverConfig, retryMode, retryConfig, chain, sourceName, sourceResolverId, sourceConfig, access],
  )
  const changes = useMemo(() => changedFields(initial, draft), [initial, draft])
  const dirty = changes.length > 0


  /** Close for real — the saved path and an untouched dialog both land here. */
  function closeNow(): void {
    setDiscard(null)
    onClose()
  }

  function requestClose(): void {
    if (pending) return
    if (!dirty) {
      closeNow()
      return
    }
    setDiscard("close")
  }

  function applyTab(next: PresetKind): void {
    setTab(next)
    setError(null)
    setFieldErrors({})
  }

  function changeTab(next: PresetKind): void {
    if (next === tab) return
    if (dirty) {
      setDiscard(next)
      return
    }
    applyTab(next)
  }

  /** "Discard" — the only place a draft is actually thrown away. */
  function discardDraft(): void {
    const target = discard
    setDiscard(null)
    if (target === null) return
    if (target === "close") {
      onClose()
      return
    }
    resetDraft()
    applyTab(target)
  }

  const profileValues = { name, engineId, resolverId, resolverConfig, retryMode, retryConfig, chain, mode, pickedSourceId }
  const profileActions: ProfileFormActions = {
    onName: setName,
    onEngine: changeEngine,
    onResolver: changeResolver,
    onResolverConfig: setResolverConfig,
    onRetryMode: changeRetryMode,
    onRetryConfig: setRetryConfig,
    onChain: setChain,
    onMode: changeResolverMode,
    onPickSource: pickSource,
    onBrowse: () => setBrowseTarget("profile"),
  }
  const sourceActions: SourceFormActions = {
    onName: setSourceName,
    onResolver: changeSourceResolver,
    onResolverConfig: setSourceConfig,
    onBrowse: () => setBrowseTarget("source"),
  }

  return (
    <>
      <Dialog
        open={open}
        onClose={requestClose}
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
          <div className="flex w-full flex-wrap items-center justify-end gap-x-3 gap-y-2">
            {blockedReason !== null ? (
              <p id={REASON_ID} className="min-w-0 flex-1 basis-full text-sm text-ink-dim sm:basis-auto">
                {blockedReason}
              </p>
            ) : null}
            <Button variant="ghost" onClick={requestClose} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form={tab === "profile" ? PROFILE_FORM_ID : SOURCE_FORM_ID}
              loading={pending}
              disabled={submitDisabled}
              aria-describedby={blockedReason === null ? undefined : REASON_ID}
            >
              {editing ? "Save changes" : tab === "profile" ? "Create profile" : "Create source"}
            </Button>
          </div>
        }
      >
        {switcher ? (
          <Segmented
            className="self-start"
            ariaLabel="Preset type"
            panelId="preset-kind"
            active={tab}
            onChange={changeTab}
            items={[
              { id: "profile", label: "Profile" },
              { id: "source", label: "Source" },
            ]}
          />
        ) : null}

        <FormPanel switcher={switcher} active={tab}>
          {tab === "profile" ? (
            <ProfileForm
              formId={PROFILE_FORM_ID}
              values={profileValues}
              actions={profileActions}
              catalogs={{
                engines,
                enginesQuery,
                resolvers,
                resolversQuery,
                sources,
                sourcesQuery,
                profiles,
                profilesQuery,
              }}
              base={base}
              fieldErrors={fieldErrors}
              nameError={duplicateName ? "A profile with this name already exists." : null}
              error={error}
              pending={pending}
              onRetryProfiles={() => void profilesQuery.refetch()}
              onSubmit={submitProfile}
            />
          ) : (
            <SourceForm
              formId={SOURCE_FORM_ID}
              values={{ name: sourceName, resolverId: sourceResolverId, resolverConfig: sourceConfig }}
              actions={sourceActions}
              catalogs={{
                engines,
                enginesQuery,
                resolvers,
                resolversQuery,
                sources,
                sourcesQuery,
                profiles,
                profilesQuery,
              }}
              fieldErrors={fieldErrors}
              nameError={duplicateSourceName ? "A source with this name already exists." : null}
              error={error}
              onSubmit={submitSource}
            />
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

        <BodyTail />
      </Dialog>

      <ConfirmDialog
        open={discard !== null}
        onClose={() => setDiscard(null)}
        title="Discard changes?"
        description={
          discard === null
            ? undefined
            : discardSentence(changes, tab, discard === "close" ? "close" : "switch")
        }
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={discardDraft}
      />
    </>
  )
}
