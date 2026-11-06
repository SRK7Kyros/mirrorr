import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ApiError,
  createAutorun,
  getErrorMessage,
  updateAutorun,
  type AutorunBody,
} from "@/api"
import { fetchAllEngines, fetchAllResolvers, fetchProfilePage } from "@/api/endpoints"
import { fetchAllLookupPages, queryKeys, queryRoots, staleTimes } from "@/api/query-keys"
import { isLive } from "@/api/domain/filter-grammar"
import type { Autorun, Engine, Profile, Resolver } from "@/api/schemas"
import { datetimeLocalToNaiveUtc, naiveUtcToDatetimeLocal, parseNaiveUtc } from "@/api/time"
import {
  Banner,
  Button,
  ConfirmDialog,
  Dialog,
  Field,
  Input,
  Segmented,
  IconSearch,
  Select,
  Switch,
  TabPanel,
  toast,
} from "@/ui/components"
import { DiscoveryDrawer, canBrowseResolver } from "@/ui/views/shared/discovery-drawer"
import { SourceFields } from "@/ui/views/shared/source-chain"
import { ChainEditor } from "@/ui/views/shared/chain-editor"
import {
  chainOf,
  chainProblemSentence,
  normaliseRung,
  profileBase,
  pruneChain,
  resolveChain,
  sameChain,
  type ChainBase,
  type ChainCatalog,
} from "@/api/domain/fallback-chain"
import {
  AccessCreation,
  useCreationAccessApplier,
} from "@/ui/views/shared/resource-access-slot"
import type { AccessTarget } from "@/api/domain/access-plan"
import {
  CatalogEmpty,
  CatalogGate,
  catalogBlockReason,
  catalogLoadingLabel,
  ENGINE_LIST_FAILED,
  PROFILE_LIST_FAILED,
  RESOLVER_LIST_FAILED,
} from "./autorun-form-catalogs"
import {
  changedFields,
  discardSentence,
  draftFrom,
  EMPTY_AUTORUN_DRAFT,
  resolveMode,
  type AutorunDraft,
  type ProfileCatalogState,
} from "./autorun-form-dirty"
import { AutorunWindowFields } from "./autorun-form-window"

/** Slug grammar enforced live in the wizard (spec §5.5). */
const SLUG_RE = /^[a-zA-Z0-9_-]+$/

/** 44 px on a coarse pointer, the sizes above elsewhere (`plan.md` §2.5). */
const COARSE_TARGET = "[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"

const REASON_ID = "autorun-submit-reason"

/**
 * Room left below the body for the footer on a phone (`P6` sticky footer).
 * 144 px is measured, not guessed: at 375 px with a coarse pointer the footer is
 * 128 px tall on a valid form and 149 px when its reason line wraps, and the space
 * left below the last field at full scroll is 173–176 px, so a focused control can
 * always be scrolled out from under the footer.
 */
const BODY_CLEARANCE =
  "flex flex-col gap-4 [&_input]:scroll-mb-36 [&_select]:scroll-mb-36 [&_textarea]:scroll-mb-36"

const NO_PROFILES: readonly Profile[] = []
const NO_ENGINES: readonly Engine[] = []
const NO_RESOLVERS: readonly Resolver[] = []

/** Friendly name → URL-safe slug preview (spec §5.5 auto-slug). */
function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
}

interface FieldIssues {
  readonly slug?: string
  readonly time?: string
  readonly general?: string
}

/** 400 duplicate → slug field; 422 tz → time field; else general (spec §5.5). */
function mapAutorunError(error: unknown): FieldIssues {
  if (error instanceof ApiError) {
    const fieldErrors = error.fieldErrors
    if (fieldErrors !== undefined) {
      const keys = Object.keys(fieldErrors)
      if (keys.includes("snake_case_name")) {
        return { slug: "A resource with that name already exists." }
      }
      if (keys.includes("start_time") || keys.includes("end_time")) {
        return { time: "Use the local-time picker — times are stored as UTC." }
      }
    }
    if (error.status === 400 && /already exists|duplicate/i.test(error.message)) {
      return { slug: "A resource with that name already exists." }
    }
    if (error.status === 422 && /(timezone|tz|offset|suffix|utc)/i.test(error.message)) {
      return { time: "Use the local-time picker — times are stored as UTC." }
    }
    return { general: error.message }
  }
  return {
    general: getErrorMessage(error, "Could not save the autorun"),
  }
}

/**
 * One-shot schedule, in one dialog: name + auto-slug, a local-time window
 * (stored UTC), a profile or a direct engine + resolver, an optional fallback
 * chain, recording on by default.
 *
 * Three things this dialog owes the operator, all from the P6 exit criteria:
 * catalogs that say "loading", "failed — retry" or "none" instead of an empty
 * select (`AUT-07`); a live run's Start locked, because the server ignores it
 * (`AUT-02`); and no close path that throws typed work away unasked.
 */
export function AutorunFormDialog({
  open,
  onClose,
  autorun,
}: {
  readonly open: boolean
  readonly onClose: () => void
  readonly autorun?: Autorun
}) {
  const queryClient = useQueryClient()
  const profilesQuery = useQuery({
    queryKey: queryKeys.profiles({ lookup: true }),
    queryFn: () => fetchAllLookupPages((cursor) => fetchProfilePage(cursor)),
    staleTime: staleTimes.lookup,
  })
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
  const profiles = profilesQuery.data ?? NO_PROFILES
  const engines = enginesQuery.data ?? NO_ENGINES
  const resolvers = resolversQuery.data ?? NO_RESOLVERS
  const editing = autorun !== undefined

  const [draft, setDraft] = useState<AutorunDraft>(EMPTY_AUTORUN_DRAFT)
  const [initial, setInitial] = useState<AutorunDraft>(EMPTY_AUTORUN_DRAFT)
  const [slugTouched, setSlugTouched] = useState(false)
  const [browseOpen, setBrowseOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [slugError, setSlugError] = useState<string | null>(null)
  const [timeError, setTimeError] = useState<string | null>(null)
  const [confirmEnd, setConfirmEnd] = useState(false)
  /**
   * The close that "Discard this autorun?" interrupted. The sequence number is
   * the prompt's React key, so a second request is its own element instead of
   * inheriting the exiting one (`P6` — same reason as the preset editor).
   */
  const [discard, setDiscard] = useState<{ readonly seq: number } | null>(null)
  const discardSeq = useRef(0)
  const openedRef = useRef<string | null>(null)

  const patch = (values: Partial<AutorunDraft>) =>
    setDraft((previous) => ({ ...previous, ...values }))

  useEffect(() => {
    if (!open) {
      openedRef.current = null
      return
    }
    const key = autorun === undefined ? "new" : String(autorun.id)
    if (openedRef.current === key) return
    openedRef.current = key
    const next = draftFrom(autorun)
    setDraft(next)
    setInitial(next)
    setSlugTouched(autorun !== undefined)
    setError(null)
    setSlugError(null)
    setTimeError(null)
    setConfirmEnd(false)
    setDiscard(null)
  }, [open, autorun])

  const live = editing && isLive(autorun.status)
  const hasCustomBase = draft.engineId !== "" && draft.resolverId !== ""
  const profileCatalog: ProfileCatalogState = profilesQuery.isError
    ? "failed"
    : profilesQuery.isLoading
      ? "loading"
      : profiles.length === 0
        ? "empty"
        : "ready"
  const mode = resolveMode(draft.mode, profileCatalog, hasCustomBase)

  const startInPast = draft.startLocal !== "" && new Date(draft.startLocal).getTime() < Date.now()
  const endBeforeStart =
    draft.startLocal !== "" &&
    draft.endLocal !== "" &&
    new Date(draft.endLocal).getTime() <= new Date(draft.startLocal).getTime()
  const endEarlierWhileLive =
    live &&
    autorun !== undefined &&
    draft.endLocal !== "" &&
    new Date(draft.endLocal).getTime() < parseNaiveUtc(autorun.end_time).getTime()
  const resolver = resolvers.find((item) => String(item.id) === draft.resolverId)
  const canBrowse = canBrowseResolver(resolver)
  const chosenProfile = profiles.find((item) => String(item.id) === draft.profileId) ?? null

  const catalog = useMemo<ChainCatalog>(
    () => ({ profiles, engines, resolvers }),
    [profiles, engines, resolvers],
  )

  const base = useMemo<ChainBase | null>(() => {
    if (mode === "profile") return chosenProfile === null ? null : profileBase(chosenProfile)
    if (!hasCustomBase) return null
    return {
      engine_id: Number(draft.engineId),
      resolver_id: Number(draft.resolverId),
      resolver_config: draft.resolverConfig,
    }
  }, [mode, chosenProfile, hasCustomBase, draft.engineId, draft.resolverId, draft.resolverConfig])

  useEffect(() => {
    if (base === null) return
    setDraft((previous) => {
      const next = pruneChain(previous.chain, base, catalog)
      return sameChain(next, previous.chain) ? previous : { ...previous, chain: next }
    })
  }, [base, catalog])

  const chainState = base === null ? null : resolveChain(draft.chain, base, catalog)
  const chainTrouble = chainState === null ? null : chainState.problem
  const canSubmit = chainState !== null && chainTrouble === null
  const applyCreation = useCreationAccessApplier()

  const save = useMutation({
    mutationFn: async (body: AutorunBody) => {
      if (autorun !== undefined) return updateAutorun(autorun.id, body)
      const created = await createAutorun(body)
      if (applyCreation === null) return created
      try {
        await applyCreation("autorun", created.id, draft.access)
      } catch (caught) {
        toast.error(
          "Autorun created, but its access was not set",
          getErrorMessage(caught, "Could not set access"),
        )
      }
      return created
    },
    onSuccess: (saved) => {
      toast.success(
        autorun === undefined ? "Autorun created" : "Autorun updated",
        saved.user_friendly_name,
      )
      void queryClient.invalidateQueries({ queryKey: queryRoots.autoruns })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.autorun(saved.id),
      })
      onClose()
    },
    onError: (caught) => {
      const issues = mapAutorunError(caught)
      setSlugError(issues.slug ?? null)
      setTimeError(issues.time ?? null)
      setError(issues.general ?? null)
    },
  })

  const persist = () => {
    setError(null)
    setSlugError(null)
    setTimeError(null)
    const initialStart = autorun === undefined ? null : naiveUtcToDatetimeLocal(autorun.start_time)
    const initialEnd = autorun === undefined ? null : naiveUtcToDatetimeLocal(autorun.end_time)
    const rungs = draft.chain.map(normaliseRung)
    save.mutate({
      user_friendly_name: draft.friendly.trim(),
      snake_case_name: draft.slug,
      ...(live
        ? endEarlierWhileLive
          ? { end_time: datetimeLocalToNaiveUtc(draft.endLocal) }
          : {}
        : {
            ...(initialStart === null || draft.startLocal !== initialStart
              ? { start_time: datetimeLocalToNaiveUtc(draft.startLocal) }
              : {}),
            ...(initialEnd === null || draft.endLocal !== initialEnd
              ? { end_time: datetimeLocalToNaiveUtc(draft.endLocal) }
              : {}),
          }),
      recording: draft.recording,
      ...(mode === "profile"
        ? {
            profile_id: Number(draft.profileId),
            fallback_chain: rungs,
          }
        : {
            engine_id: Number(draft.engineId),
            resolver_id: Number(draft.resolverId),
            resolver_config: draft.resolverConfig,
            fallback_chain: rungs,
          }),
    })
  }

  const submit = () => {
    setError(null)
    setSlugError(null)
    setTimeError(null)
    if (!SLUG_RE.test(draft.slug)) {
      setSlugError("Use letters, numbers, hyphens and underscores only.")
      return
    }
    if (draft.startLocal === "" || draft.endLocal === "") {
      setTimeError("Pick a start and end time.")
      return
    }
    if (endBeforeStart) {
      setTimeError("End must be after start.")
      return
    }
    if (!canSubmit) {
      setError(
        chainTrouble === null
          ? "Pick a profile, or an engine and resolver."
          : chainProblemSentence(chainTrouble, "run"),
      )
      return
    }
    if (endEarlierWhileLive) {
      setConfirmEnd(true)
      return
    }
    persist()
  }

  const changes = useMemo(() => changedFields(initial, draft), [initial, draft])
  const dirty = changes.length > 0

  /** Scrim, Escape, the close button and Cancel all land here (`P6`). */
  const requestClose = () => {
    if (save.isPending) return
    if (!dirty) {
      onClose()
      return
    }
    discardSeq.current += 1
    setDiscard({ seq: discardSeq.current })
  }

  /** "Discard" — the only place a draft is actually thrown away. */
  const discardDraft = () => {
    setDiscard(null)
    onClose()
  }

  const catalogReason = catalogBlockReason(mode, {
    profileEmpty: draft.profileId === "",
    engineEmpty: draft.engineId === "",
    resolverEmpty: draft.resolverId === "",
    profilesFailed: profilesQuery.isError,
    enginesFailed: enginesQuery.isError,
    resolversFailed: resolversQuery.isError,
  })
  const catalogsPending =
    mode === "profile"
      ? profilesQuery.isLoading
      : enginesQuery.isLoading || resolversQuery.isLoading
  const blockedReason =
    catalogReason ??
    (chainTrouble === null ? null : chainProblemSentence(chainTrouble, "run")) ??
    (base === null
      ? catalogsPending
        ? `${catalogLoadingLabel(mode)}…`
        : "Pick a profile, or an engine and resolver."
      : null)

  return (
    <>
      <Dialog
        open={open}
        onClose={requestClose}
        title={editing ? "Edit autorun" : "New autorun"}
        description="A one-off recording at the window you choose."
        size="lg"
        busy={save.isPending}
        footer={
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <p className="text-sm text-ink-dim sm:flex-1">
              Runs once at its start time, then retires.
            </p>
            {blockedReason === null ? null : (
              <p id={REASON_ID} className="text-sm text-ink-dim sm:max-w-[22rem]">
                {blockedReason}
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                className={COARSE_TARGET}
                onClick={requestClose}
                disabled={save.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                className={COARSE_TARGET}
                loading={save.isPending}
                disabled={blockedReason !== null}
                aria-describedby={blockedReason === null ? undefined : REASON_ID}
                onClick={submit}
              >
                {editing ? "Save changes" : "Create autorun"}
              </Button>
            </div>
          </div>
        }
      >
        <div className={BODY_CLEARANCE}>
          {error !== null ? <Banner kind="danger" title={error} /> : null}
          {startInPast && (autorun === undefined || autorun.status === "scheduled") ? (
            <Banner
              kind="warning"
              title="Start time is in the past — the server will fire it immediately."
            />
          ) : null}

          <Field label="Name" htmlFor="autorun-friendly" required>
            <Input
              id="autorun-friendly"
              value={draft.friendly}
              autoComplete="off"
              placeholder="e.g. Nightly news"
              onChange={(event) => {
                const value = event.target.value
                patch(
                  slugTouched
                    ? { friendly: value }
                    : { friendly: value, slug: slugify(value) },
                )
              }}
            />
          </Field>

          <Field
            label="Slug"
            htmlFor="autorun-slug"
            required
            error={slugError}
            hint={`Used in URLs. Preview: ${draft.slug === "" ? "—" : draft.slug}`}
          >
            <Input
              id="autorun-slug"
              value={draft.slug}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={slugError !== null}
              onChange={(event) => {
                setSlugTouched(true)
                patch({ slug: event.target.value })
              }}
            />
          </Field>

          <AutorunWindowFields
            startLocal={draft.startLocal}
            endLocal={draft.endLocal}
            live={live}
            timeError={timeError}
            onStart={(value) => patch({ startLocal: value })}
            onEnd={(value) => patch({ endLocal: value })}
          />

          <Field
            label="Start from"
            hint={live ? "Changes affect a future run, not the current one." : undefined}
          >
            <Segmented
              ariaLabel="Start from"
              panelId="autorun-mode"
              active={mode}
              onChange={(next) => patch({ mode: next })}
              items={[
                {
                  id: "profile",
                  label: "A profile",
                  disabled: profiles.length === 0 || live,
                },
                { id: "custom", label: "Engine + resolver", disabled: live },
              ]}
            />
          </Field>

          <TabPanel panelId="autorun-mode" active={mode} className="flex flex-col gap-4">
            {mode === "profile" ? (
              <CatalogGate
                query={profilesQuery}
                errorMessage={PROFILE_LIST_FAILED}
                loadingLabel="Loading profiles"
                isEmpty={profiles.length === 0}
                empty={
                  <CatalogEmpty>
                    No profiles yet — create one under Profiles, or start from an engine and
                    resolver here.
                  </CatalogEmpty>
                }
              >
                <Field label="Profile" htmlFor="autorun-profile" required>
                  <Select
                    id="autorun-profile"
                    value={draft.profileId}
                    disabled={live}
                    onChange={(event) => {
                      const next = event.target.value
                      const profile = profiles.find((item) => String(item.id) === next)
                      // The chain travels with the profile it was written for.
                      patch({
                        profileId: next,
                        chain: profile === undefined ? [] : chainOf(profile),
                      })
                    }}
                  >
                    <option value="">Select a profile…</option>
                    {profiles.map((profile) => (
                      <option key={profile.id} value={String(profile.id)}>
                        {profile.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </CatalogGate>
            ) : (
              <>
                <CatalogGate
                  query={enginesQuery}
                  errorMessage={ENGINE_LIST_FAILED}
                  loadingLabel="Loading engines"
                  isEmpty={engines.length === 0}
                  empty={<CatalogEmpty>No engines are configured on this server.</CatalogEmpty>}
                >
                  <Field label="Engine" htmlFor="autorun-engine" required>
                    <Select
                      id="autorun-engine"
                      value={draft.engineId}
                      disabled={live}
                      onChange={(event) => patch({ engineId: event.target.value })}
                    >
                      <option value="">Select an engine…</option>
                      {engines.map((engine) => (
                        <option key={engine.id} value={String(engine.id)}>
                          {engine.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </CatalogGate>
                <CatalogGate
                  query={resolversQuery}
                  errorMessage={RESOLVER_LIST_FAILED}
                  loadingLabel="Loading resolvers"
                  isEmpty={resolvers.length === 0}
                  empty={<CatalogEmpty>No resolvers are configured on this server.</CatalogEmpty>}
                >
                  {live ? (
                    <Field label="Resolver" htmlFor="autorun-resolver">
                      <Select id="autorun-resolver" value={draft.resolverId} disabled>
                        <option value="">Select a resolver…</option>
                        {resolvers.map((item) => (
                          <option key={item.id} value={String(item.id)}>
                            {item.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  ) : draft.engineId === "" ? null : (
                    <SourceFields
                      idPrefix="autorun"
                      kindLabel="Primary source"
                      resolvers={resolvers}
                      value={{ resolverId: resolver?.id ?? null, resolverConfig: draft.resolverConfig }}
                      onChange={(next) =>
                        patch({
                          resolverId: next.resolverId === null ? "" : String(next.resolverId),
                          resolverConfig: next.resolverConfig,
                        })
                      }
                      browse={
                        canBrowse && resolver !== undefined ? (
                          <div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className={COARSE_TARGET}
                              icon={<IconSearch size={15} />}
                              onClick={() => setBrowseOpen(true)}
                            >
                              Browse {resolver.name}…
                            </Button>
                          </div>
                        ) : undefined
                      }
                    />
                  )}
                </CatalogGate>
              </>
            )}

            {base === null ? null : (
              <ChainEditor
                idPrefix="autorun"
                catalog={catalog}
                base={base}
                value={draft.chain}
                onChange={(next) => patch({ chain: next })}
                disabled={live}
              />
            )}
          </TabPanel>

          <Switch
            label="Record this run"
            className="[@media(pointer:coarse)]:min-h-11"
            checked={draft.recording}
            onChange={(event) => patch({ recording: event.target.checked })}
          />

          {editing ? null : (
            <AccessCreation
              resourceType="autorun"
              onChange={(next: AccessTarget) => patch({ access: next })}
              busy={save.isPending}
            />
          )}

          {/* Clearance for the footer: a focused control stops above it, never flush. */}
          <div aria-hidden="true" className="hidden h-36 shrink-0 max-sm:block" />
        </div>
      </Dialog>

      <DiscoveryDrawer
        open={browseOpen}
        onClose={() => setBrowseOpen(false)}
        resolver={resolver ?? null}
        onUse={(item) => {
          patch({ resolverConfig: item.config ?? {} })
          setBrowseOpen(false)
        }}
      />

      <ConfirmDialog
        open={confirmEnd}
        onClose={() => setConfirmEnd(false)}
        title="Move the end time earlier?"
        description="Moving the end time earlier may stop the running recording."
        confirmLabel="Move end time"
        onConfirm={() => {
          setConfirmEnd(false)
          persist()
        }}
      />

      <ConfirmDialog
        key={discardSeq.current}
        open={discard !== null}
        onClose={() => setDiscard(null)}
        title="Discard this autorun?"
        description={discard === null ? undefined : discardSentence(changes)}
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={discardDraft}
      />
    </>
  )
}
