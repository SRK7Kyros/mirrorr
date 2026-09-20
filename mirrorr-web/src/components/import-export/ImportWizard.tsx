/**
 * V10 — the import wizard (spec L347-L362, L522-L548).
 *
 * Four steps over one reducer (`@/lib/import-wizard`, unit-tested pure):
 * choose file → review report → resolve issues → apply summary. The component
 * owns only the effects: file reading, the validate/apply calls, the catalogs,
 * cache invalidation and toasts.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useEffect, useReducer, useRef, type ChangeEvent } from "react"
import { Button } from "@/components/ui/Button"
import { ErrorPanel } from "@/components/ui/ErrorPanel"
import { FOCUS_RING } from "@/components/ui/focus-ring"
import { Select } from "@/components/ui/Select"
import { SkeletonRows, SKELETON_PRESETS } from "@/components/ui/SkeletonRows"
import { Switch } from "@/components/ui/Switch"
import { userMessageForError } from "@/lib/errors"
import { applyBundle, validateBundle } from "@/lib/import-export-api"
import {
  applyBody,
  badgeForItem,
  canApply,
  editedBundle,
  engineOverrideRequirements,
  initialWizardState,
  mappingRequirements,
  parseBundleText,
  profileMissingRequirements,
  renamePreview,
  unresolvedCount,
  wizardReducer,
  type BadgeKey,
  type WizardState,
} from "@/lib/import-wizard"
import { QUERY_STALE_TIMES_MS, queryKeys } from "@/lib/query-keys"
import type { ValidateItem } from "@/lib/schemas/import-export"
import { fetchAllEngines, fetchAllProfiles, fetchAllResolvers } from "@/lib/sessions-api"
import { showToast } from "@/lib/toast"

export const WIZARD_STEP_LABELS = ["Choose file", "Review report", "Resolve", "Apply summary"] as const
export const WIZARD_FILE_LABEL = "Bundle file"
export const INLINE_PROFILE_OPTION = "Use inline config"
export const APPLY_ERROR_TITLE = "Import failed"
export const VIEW_PROFILES_LABEL = "View profiles"
export const NO_FILE_HINT = "Pick a version 1 bundle exported from another Mirrorr instance."

const HASH_PREVIEW_LENGTH = 12

const BADGE_CLASSES: Record<BadgeKey, string> = {
  ready: "text-ok",
  skip: "text-text-muted",
  mapping: "text-text-primary",
  conflict: "text-danger",
}

function plural(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`
}

function shortHash(hash: string | undefined): string | null {
  if (hash === undefined || hash === "") return null
  return `${hash.slice(0, HASH_PREVIEW_LENGTH)}…`
}

function conflictPreviews(items: readonly ValidateItem[], installedNames: readonly string[]) {
  const previews = new Map<string, string>()
  const reserved: string[] = []
  for (const item of items) {
    if (!item.issues.some((issue) => issue.problem === "name_conflict")) continue
    const preview = renamePreview(item.name, installedNames, reserved)
    reserved.push(preview)
    previews.set(item.name, preview)
  }
  return previews
}

function ReviewCard({ kind, item, rename }: { readonly kind: string; readonly item: ValidateItem; readonly rename?: string }) {
  const badge = badgeForItem(item)
  const hash = shortHash(item.content_hash)
  return (
    <article
      data-testid={`review-item-${kind}-${item.name}`}
      className="flex flex-col gap-1 rounded-surface border border-border bg-bg-raised p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-body font-medium text-text-primary">{item.name}</h3>
        <span
          data-testid={`badge-${kind}-${item.name}`}
          className={`rounded-pill border border-border bg-bg-inset px-2 py-0.5 text-micro font-medium ${BADGE_CLASSES[badge.key]}`}
        >
          {badge.label}
        </span>
      </div>
      {hash === null ? null : (
        <p className="font-mono text-small text-text-muted" title={item.content_hash}>
          {hash}
        </p>
      )}
      {rename === undefined ? null : (
        <p className="text-small text-text-secondary">Will be imported as {rename}</p>
      )}
    </article>
  )
}

export function ImportWizard() {
  const [state, dispatch] = useReducer(wizardReducer, initialWizardState)
  const queryClient = useQueryClient()
  const panelRef = useRef<HTMLDivElement>(null)

  const enginesQuery = useQuery({
    queryKey: queryKeys.engines(),
    queryFn: ({ signal }) => fetchAllEngines(signal),
    staleTime: QUERY_STALE_TIMES_MS.engines,
  })
  const resolversQuery = useQuery({
    queryKey: queryKeys.resolvers(),
    queryFn: ({ signal }) => fetchAllResolvers(signal),
    staleTime: QUERY_STALE_TIMES_MS.resolvers,
  })
  const profilesQuery = useQuery({
    queryKey: queryKeys.profilesCatalog(),
    queryFn: ({ signal }) => fetchAllProfiles(signal),
    staleTime: QUERY_STALE_TIMES_MS.profiles,
  })

  useEffect(() => {
    panelRef.current?.focus()
  }, [state.step])

  const engines = enginesQuery.data ?? []
  const resolvers = resolversQuery.data ?? []
  const installedProfiles = profilesQuery.data ?? []
  const installedNames = installedProfiles.map((profile) => profile.name)

  const mappingReqs = state.report === null ? [] : mappingRequirements(state.report)
  const missingReqs = state.report === null ? [] : profileMissingRequirements(state.report)
  const overrideReqs = state.bundle === null ? [] : engineOverrideRequirements(state.bundle)
  const unresolved = unresolvedCount(state)
  const reviewProfiles = state.report?.profiles ?? []
  const reviewAutoruns = state.report?.autoruns ?? []
  const profileRenames = conflictPreviews(reviewProfiles, installedNames)
  const autorunRenames = conflictPreviews(reviewAutoruns, installedNames)
  const catalogsError = enginesQuery.error ?? resolversQuery.error ?? profilesQuery.error
  const catalogsPending = enginesQuery.isPending || resolversQuery.isPending || profilesQuery.isPending
  const edited = editedBundle(state)
  const stepIndex = WIZARD_STEP_LABELS.indexOf(
    state.step === "choose" ? "Choose file" : state.step === "review" ? "Review report" : state.step === "resolve" ? "Resolve" : "Apply summary",
  )

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file === undefined) return
    dispatch({ type: "file-selected", fileName: file.name })
    let text: string
    try {
      text = await file.text()
    } catch {
      dispatch({ type: "file-rejected", message: "That file could not be read." })
      return
    }
    const result = parseBundleText(text)
    if (!result.ok) {
      dispatch({ type: "file-rejected", message: result.message })
      return
    }
    dispatch({ type: "file-parsed", fileName: file.name, bundle: result.bundle })
  }

  async function handleValidate() {
    if (state.bundle === null) return
    dispatch({ type: "validation-started" })
    try {
      const report = await validateBundle(state.bundle)
      dispatch({ type: "validation-succeeded", report })
    } catch (error) {
      dispatch({ type: "validation-failed", message: userMessageForError(error) })
    }
  }

  async function handleApply() {
    const body = applyBody(state)
    if (body === null) return
    dispatch({ type: "apply-started" })
    try {
      const summary = await applyBundle(body)
      dispatch({ type: "apply-succeeded", summary })
      showToast(
        `${summary.profiles_created} ${plural(summary.profiles_created, "profile")} and ${summary.autoruns_created} ${plural(summary.autoruns_created, "autorun")} imported`,
        "info",
      )
      void queryClient.invalidateQueries({ queryKey: queryKeys.profilesAll() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.autorunsAll() })
    } catch (error) {
      dispatch({ type: "apply-failed", message: userMessageForError(error) })
    }
  }

  function retryCatalogs() {
    void enginesQuery.refetch()
    void resolversQuery.refetch()
    void profilesQuery.refetch()
  }

  function resolutionFor(autorunName: string): WizardState["engineOverrides"][string] {
    return state.engineOverrides[autorunName] ?? "keep"
  }

  return (
    <section
      data-testid="import-wizard"
      aria-labelledby="import-wizard-heading"
      className="flex min-h-[60vh] flex-col gap-4 rounded-surface border border-border bg-bg-base p-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex flex-col gap-1">
          <h2 id="import-wizard-heading" className="text-heading font-medium text-text-primary">
            Import bundle
          </h2>
          <p data-testid="wizard-step" aria-live="polite" className="text-small text-text-secondary">
            Step {stepIndex + 1} of 4 — {WIZARD_STEP_LABELS[stepIndex]}
          </p>
        </div>
        <Button variant="ghost" onClick={() => dispatch({ type: "reset" })}>
          Cancel
        </Button>
      </header>

      <div ref={panelRef} tabIndex={-1} className={`flex flex-1 flex-col gap-4 rounded-control ${FOCUS_RING}`}>
        {state.step === "choose" ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <span className="text-label text-text-secondary">{WIZARD_FILE_LABEL}</span>
              <input
                id="import-bundle-file"
                type="file"
                accept="application/json"
                aria-label={WIZARD_FILE_LABEL}
                className="peer sr-only"
                onChange={(event) => void handleFileChange(event)}
              />
              <label
                htmlFor="import-bundle-file"
                className="inline-flex h-11 w-fit cursor-pointer items-center justify-center rounded-control border border-border bg-bg-overlay px-4 text-body font-medium text-text-primary hover:bg-bg-raised peer-focus-visible:ring-2 peer-focus-visible:ring-accent"
              >
                Choose file
              </label>
              <p className="text-small text-text-muted">{NO_FILE_HINT}</p>
            </div>

            {state.guardError === null ? null : (
              <p data-testid="guard-error" role="alert" className="text-body text-danger">
                {state.guardError}
              </p>
            )}

            {state.validationError === null ? null : (
              <ErrorPanel message={state.validationError} title="Validation failed" onRetry={() => void handleValidate()} />
            )}

            {state.bundle === null || state.fileName === null ? null : (
              <p data-testid="picked-file" aria-live="polite" className="text-body text-text-secondary">
                {state.fileName} — {state.bundle.profiles.length} profiles, {state.bundle.autoruns.length}{" "}
                {plural(state.bundle.autoruns.length, "autorun")}
              </p>
            )}
          </div>
        ) : null}

        {state.step === "review" ? (
          <div data-testid="wizard-review" className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <h3 className="text-body font-medium text-text-primary">Profiles</h3>
              {reviewProfiles.map((item) => (
                <ReviewCard key={item.name} kind="profile" item={item} rename={profileRenames.get(item.name)} />
              ))}
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-body font-medium text-text-primary">Autoruns</h3>
              {reviewAutoruns.map((item) => (
                <ReviewCard key={item.name} kind="autorun" item={item} rename={autorunRenames.get(item.name)} />
              ))}
            </div>
          </div>
        ) : null}

        {state.step === "resolve" ? (
          <div data-testid="wizard-resolve" className="flex flex-col gap-5">
            {state.applyError === null ? null : <ErrorPanel message={state.applyError} title={APPLY_ERROR_TITLE} />}

            {catalogsError === null ? null : <ErrorPanel message={userMessageForError(catalogsError)} onRetry={retryCatalogs} />}
            {catalogsPending ? <SkeletonRows {...SKELETON_PRESETS.sessions} label="Loading plugins" /> : null}

            {unresolved > 0 ? (
              <p data-testid="unresolved-hint" className="text-small text-text-secondary">
                Resolve {unresolved} {plural(unresolved, "issue")} to enable Apply.
              </p>
            ) : null}

            {mappingReqs.length === 0 ? null : (
              <fieldset className="flex flex-col gap-3">
                <legend className="text-body font-medium text-text-primary">Plugin mapping</legend>
                {mappingReqs.map((requirement) => (
                  <Select
                    key={requirement.key}
                    label={`${requirement.field === "engine" ? "Engine" : "Resolver"} for ${requirement.bundledName} (${requirement.itemName})`}
                    value={state.mappings[requirement.key] === undefined ? "" : String(state.mappings[requirement.key])}
                    onChange={(event) =>
                      dispatch({ type: "mapping-changed", key: requirement.key, pluginId: Number(event.target.value) })
                    }
                  >
                    <option value="">Choose manually</option>
                    {(requirement.pluginType === "engine" ? engines : resolvers).map((plugin) => (
                      <option key={plugin.id} value={String(plugin.id)}>
                        {plugin.name} — {(plugin.origin_hash ?? "").slice(0, HASH_PREVIEW_LENGTH)}…
                      </option>
                    ))}
                  </Select>
                ))}
              </fieldset>
            )}

            {missingReqs.length === 0 ? null : (
              <fieldset className="flex flex-col gap-3">
                <legend className="text-body font-medium text-text-primary">Missing profiles</legend>
                {missingReqs.map((requirement) => {
                  const resolution = state.profileMissing[requirement.autorunName]
                  const value =
                    resolution === undefined ? "" : resolution.kind === "inline" ? "__inline__" : resolution.profileName
                  return (
                    <Select
                      key={requirement.autorunName}
                      label={`Profile for ${requirement.autorunName}`}
                      value={value}
                      onChange={(event) => {
                        const next = event.target.value
                        dispatch({
                          type: "profile-missing-changed",
                          autorunName: requirement.autorunName,
                          resolution: next === "__inline__" ? { kind: "inline" } : { kind: "bind", profileName: next },
                        })
                      }}
                    >
                      <option value="">Choose a resolution</option>
                      <option value="__inline__">{INLINE_PROFILE_OPTION}</option>
                      {installedProfiles.map((profile) => (
                        <option key={profile.id} value={profile.name}>
                          {profile.name}
                        </option>
                      ))}
                    </Select>
                  )
                })}
              </fieldset>
            )}

            {overrideReqs.length === 0 ? null : (
              <fieldset className="flex flex-col gap-2">
                <legend className="text-body font-medium text-text-primary">Engine overrides</legend>
                {overrideReqs.map((requirement) => {
                  const resolution = resolutionFor(requirement.autorunName)
                  return (
                    <div key={requirement.autorunName} className="flex flex-col gap-1">
                      <span className="text-label text-text-secondary">
                        Engine override for {requirement.autorunName} ({requirement.engineName})
                      </span>
                      <label className="flex min-h-11 items-center gap-2 text-body text-text-primary">
                        <input
                          type="radio"
                          name={`engine-override-${requirement.autorunName}`}
                          value="keep"
                          checked={resolution === "keep"}
                          onChange={() =>
                            dispatch({
                              type: "engine-override-changed",
                              autorunName: requirement.autorunName,
                              resolution: "keep",
                            })
                          }
                        />
                        Keep autorun engine
                      </label>
                      <label className="flex min-h-11 items-center gap-2 text-body text-text-primary">
                        <input
                          type="radio"
                          name={`engine-override-${requirement.autorunName}`}
                          value="inherit"
                          checked={resolution === "inherit"}
                          onChange={() =>
                            dispatch({
                              type: "engine-override-changed",
                              autorunName: requirement.autorunName,
                              resolution: "inherit",
                            })
                          }
                        />
                        Use profile engine
                      </label>
                    </div>
                  )
                })}
              </fieldset>
            )}

            <fieldset className="flex flex-col gap-2">
              <legend className="text-body font-medium text-text-primary">Include items</legend>
              {(state.bundle?.profiles ?? []).map((profile) => (
                <Switch
                  key={profile.name}
                  label={`Include ${profile.name}`}
                  checked={!state.excludedProfiles.includes(profile.name)}
                  onCheckedChange={(included) =>
                    dispatch({ type: "include-toggled", kind: "profile", name: profile.name, included })
                  }
                />
              ))}
              {(state.bundle?.autoruns ?? []).map((autorun) => (
                <Switch
                  key={autorun.user_friendly_name}
                  label={`Include ${autorun.user_friendly_name}`}
                  checked={!state.excludedAutoruns.includes(autorun.user_friendly_name)}
                  onCheckedChange={(included) =>
                    dispatch({ type: "include-toggled", kind: "autorun", name: autorun.user_friendly_name, included })
                  }
                />
              ))}
            </fieldset>

            {edited === null ? null : (
              <details data-testid="bundle-preview" className="rounded-control border border-border bg-bg-raised">
                <summary className="cursor-pointer px-3 py-2 text-small font-medium text-text-secondary">
                  Bundle preview (edited)
                </summary>
                <pre className="overflow-x-auto border-t border-border p-3 font-mono text-small text-text-secondary">
                  {JSON.stringify(edited, null, 2)}
                </pre>
              </details>
            )}
          </div>
        ) : null}

        {state.step === "apply" && state.summary !== null ? (
          <div data-testid="apply-summary" aria-live="polite" className="flex flex-col gap-3">
            <h3 className="text-body font-medium text-text-primary">Import complete</h3>
            <dl className="flex flex-col gap-1 text-body text-text-secondary">
              <div>
                <dt className="inline text-text-muted">Profiles created: </dt>
                <dd className="inline">{state.summary.profiles_created} profiles created</dd>
              </div>
              <div>
                <dt className="inline text-text-muted">Profiles skipped: </dt>
                <dd className="inline">
                  {state.summary.profiles_skipped} profiles skipped (already imported)
                </dd>
              </div>
              <div>
                <dt className="inline text-text-muted">Autoruns created: </dt>
                <dd className="inline">
                  {state.summary.autoruns_created} {plural(state.summary.autoruns_created, "autorun")} created
                </dd>
              </div>
            </dl>
            <Link to="/profiles" className="w-fit text-body font-medium text-accent hover:text-accent-hover">
              {VIEW_PROFILES_LABEL}
            </Link>
          </div>
        ) : null}
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-border pt-3">
        <Button
          variant="secondary"
          disabled={state.step === "choose" || state.step === "apply"}
          onClick={() => dispatch({ type: "back" })}
        >
          Back
        </Button>
        {state.step === "choose" ? (
          <Button
            variant="primary"
            disabled={state.bundle === null || state.guardError !== null || state.status === "validating"}
            onClick={() => void handleValidate()}
          >
            {state.status === "validating" ? "Validating…" : "Validate"}
          </Button>
        ) : null}
        {state.step === "review" ? (
          <Button variant="primary" onClick={() => dispatch({ type: "next" })}>
            Next
          </Button>
        ) : null}
        {state.step === "resolve" ? (
          <Button variant="primary" disabled={!canApply(state) || state.status === "applying"} onClick={() => void handleApply()}>
            {state.status === "applying" ? "Applying…" : "Apply"}
          </Button>
        ) : null}
      </footer>
    </section>
  )
}
