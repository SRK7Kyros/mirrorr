import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createSession, getErrorMessage, type SessionCreateBody } from "@/api"
import { queryRoots } from "@/api/query-keys"
import {
  Banner,
  Button,
  ConfirmDialog,
  Dialog,
  Field,
  IconSearch,
  QueryState,
  Segmented,
  Select,
  Skeleton,
  Switch,
  TabPanel,
  toast,
} from "@/ui/components"
import { DiscoveryDrawer, canBrowseResolver } from "@/ui/views/shared/discovery-drawer"
import { SourceFields } from "@/ui/views/shared/source-chain"
import { ChainEditor } from "@/ui/views/shared/chain-editor"
import {
  chainOf,
  normaliseRung,
  pruneChain,
  profileBase,
  resolveChain,
  sameChain,
  type ChainBase,
  type ChainCatalog,
  type FallbackRung,
} from "@/api/domain/fallback-chain"
import { AccessCreation, useCreationAccessApplier } from "@/ui/views/shared/resource-access-slot"
import type { AccessTarget } from "@/api/domain/access-plan"
import { useNewSessionCatalogs } from "./new-session-catalogs"
import { ProfileSummary } from "./new-session-profile-summary"
import { submitBlockedReason } from "./new-session-reason"

const REASON_ID = "new-session-submit-reason"

function fieldSkeleton(label: string) {
  return (
    <div className="flex flex-col gap-2" role="status" aria-label={label}>
      <Skeleton width="5rem" height={12} />
      <Skeleton width="100%" height={34} />
    </div>
  )
}

export function NewSessionDialog({
  open,
  onClose,
}: {
  readonly open: boolean
  readonly onClose: () => void
}) {
  const queryClient = useQueryClient()
  const catalogs = useNewSessionCatalogs()
  const profiles = catalogs.profiles.items
  const engines = catalogs.engines.items
  const resolvers = catalogs.resolvers.items

  const [mode, setMode] = useState<"profile" | "custom">("profile")
  const [profileId, setProfileId] = useState("")
  const [engineId, setEngineId] = useState("")
  const [resolverId, setResolverId] = useState("")
  const [resolverConfig, setResolverConfig] = useState<Record<string, unknown>>({})
  const [chain, setChain] = useState<FallbackRung[]>([])
  const [browseOpen, setBrowseOpen] = useState(false)
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [access, setAccess] = useState<AccessTarget>({})
  const [discardOpen, setDiscardOpen] = useState(false)
  const applyCreation = useCreationAccessApplier()

  const openedRef = useRef(false)
  const modeTouchedRef = useRef(false)

  const catalog = useMemo<ChainCatalog>(
    () => ({ profiles, engines, resolvers }),
    [profiles, engines, resolvers],
  )

  useEffect(() => {
    if (!open) {
      openedRef.current = false
      return
    }
    if (openedRef.current) return
    openedRef.current = true
    modeTouchedRef.current = false
    setError(null)
    setMode(profiles.length > 0 ? "profile" : "custom")
    setProfileId("")
    setEngineId("")
    setResolverId("")
    setResolverConfig({})
    setChain([])
    setRecording(false)
    setAccess({})
    setDiscardOpen(false)
  }, [open, profiles.length])

  /**
   * The default mode depends on whether any profile exists, and that answer
   * arrives after the dialog opens. Opening early used to freeze "Engine +
   * resolver" even once the profiles landed — the same defect `AUT-07` records
   * for the autorun form. Re-evaluate until the operator picks a mode himself.
   */
  useEffect(() => {
    if (!open || modeTouchedRef.current || catalogs.profiles.isLoading) return
    setMode(catalogs.profiles.items.length > 0 ? "profile" : "custom")
  }, [open, catalogs.profiles.isLoading, catalogs.profiles.items.length])

  const create = useMutation({
    mutationFn: async (body: SessionCreateBody) => {
      const session = await createSession(body)
      if (applyCreation === null) return session
      try {
        await applyCreation("session", session.id, access)
      } catch (caught) {
        toast.error(
          "Session started, but its access was not set",
          getErrorMessage(caught, "Could not set access"),
        )
      }
      return session
    },
    onSuccess: (session) => {
      toast.success("Session started", `#${session.id}`)
      void queryClient.invalidateQueries({ queryKey: queryRoots.sessions })
      onClose()
    },
    onError: (caught) => setError(getErrorMessage(caught, "Could not start the session")),
  })

  const resolver = resolvers.find((item) => String(item.id) === resolverId)
  const chosenProfile = profiles.find((item) => String(item.id) === profileId) ?? null
  const canBrowse = canBrowseResolver(resolver)

  const base = useMemo<ChainBase | null>(() => {
    if (mode === "profile") return chosenProfile === null ? null : profileBase(chosenProfile)
    if (engineId === "" || resolverId === "") return null
    return {
      engine_id: Number(engineId),
      resolver_id: Number(resolverId),
      resolver_config: resolverConfig,
    }
  }, [mode, chosenProfile, engineId, resolverId, resolverConfig])

  useEffect(() => {
    if (base === null) return
    setChain((previous) => {
      const next = pruneChain(previous, base, catalog)
      return sameChain(next, previous) ? previous : next
    })
  }, [base, catalog])

  const chainState = base === null ? null : resolveChain(chain, base, catalog)
  const blockedReason = submitBlockedReason({
    mode,
    profileId,
    engineId,
    resolverId,
    profilesLoading: catalogs.profiles.isLoading,
    profilesError: catalogs.profiles.isError,
    enginesLoading: catalogs.engines.isLoading,
    enginesError: catalogs.engines.isError,
    resolversLoading: catalogs.resolvers.isLoading,
    resolversError: catalogs.resolvers.isError,
    chainProblem: chainState?.problem ?? null,
  })
  const canSubmit = blockedReason === null

  // Only work that took typing or several steps asks before it is thrown away;
  // picking a profile and cancelling is one click to redo, and a prompt there
  // would teach the operator to dismiss prompts.
  const hasWork =
    chain.length > 0 ||
    Object.keys(resolverConfig).length > 0 ||
    Object.keys(access).length > 0

  const requestClose = () => {
    if (create.isPending) return
    if (hasWork) {
      setDiscardOpen(true)
      return
    }
    onClose()
  }

  const submit = () => {
    setError(null)
    const rungs = chain.map(normaliseRung)
    const body: SessionCreateBody =
      mode === "profile"
        ? {
            profile_id: Number(profileId),
            fallback_chain: rungs,
            recording,
          }
        : {
            engine_id: Number(engineId),
            resolver_id: Number(resolverId),
            resolver_config: resolverConfig,
            fallback_chain: rungs,
            recording,
          }
    create.mutate(body)
  }

  return (
    <>
      <Dialog
        open={open}
        onClose={requestClose}
        title="New session"
        description="Start a capture now. A profile carries its own engine, resolver and retry policy."
        size="xl"
        busy={create.isPending}
        footer={
          <div className="flex w-full flex-wrap items-center justify-end gap-x-3 gap-y-2">
            {blockedReason !== null ? (
              <p id={REASON_ID} className="min-w-0 flex-1 basis-full text-sm text-ink-dim sm:basis-auto">
                {blockedReason}
              </p>
            ) : null}
            <Button variant="ghost" onClick={requestClose} disabled={create.isPending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={create.isPending}
              disabled={!canSubmit}
              aria-describedby={blockedReason === null ? undefined : REASON_ID}
              onClick={submit}
            >
              Start session
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-5">
          {error !== null ? <Banner kind="danger" title={error} /> : null}

          <Field label="Start from">
            <Segmented
              ariaLabel="Start from"
              panelId="new-session-mode"
              active={mode}
              onChange={(next) => {
                modeTouchedRef.current = true
                setMode(next)
              }}
              items={[
                {
                  id: "profile",
                  label: "A profile",
                  // A failed catalog is not an empty one: leave the tab reachable so
                  // its error panel and Retry can actually be seen (`CMP-08`).
                  disabled:
                    !catalogs.profiles.isLoading &&
                    !catalogs.profiles.isError &&
                    profiles.length === 0,
                },
                { id: "custom", label: "Engine + resolver" },
              ]}
            />
          </Field>

          <TabPanel panelId="new-session-mode" active={mode} className="flex flex-col gap-4">
            {mode === "profile" ? (
              <>
                <QueryState
                  query={catalogs.profiles}
                  loading={fieldSkeleton("Loading profiles")}
                  errorMessage="Could not load the profiles"
                  isEmpty={profiles.length === 0}
                  empty={
                    <p className="text-base text-ink-dim">
                      No profiles yet — start from an engine and a source, or build a profile on
                      Profiles.
                    </p>
                  }
                >
                  <Field
                    label="Profile"
                    htmlFor="new-session-profile"
                    required
                    hint={`${profiles.length} available`}
                  >
                    <Select
                      id="new-session-profile"
                      value={profileId}
                      onChange={(event) => {
                        const next = event.target.value
                        setProfileId(next)
                        const profile = profiles.find((item) => String(item.id) === next)
                        // The chain goes with the profile it was written for — its
                        // own rungs are what runs unless the user changes them.
                        setChain(profile === undefined ? [] : chainOf(profile))
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
                </QueryState>

                {chosenProfile === null ? null : (
                  <ProfileSummary
                    profile={chosenProfile}
                    engines={engines}
                    resolvers={resolvers}
                    recording={recording}
                  />
                )}
              </>
            ) : (
              <>
                <QueryState
                  query={catalogs.engines}
                  loading={fieldSkeleton("Loading engines")}
                  errorMessage="Could not load the engines"
                >
                  <Field label="Engine" htmlFor="new-session-engine" required>
                    <Select
                      id="new-session-engine"
                      value={engineId}
                      onChange={(event) => setEngineId(event.target.value)}
                    >
                      <option value="">Select an engine…</option>
                      {engines.map((engine) => (
                        <option key={engine.id} value={String(engine.id)}>
                          {engine.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </QueryState>
                {engineId === "" ? null : (
                  <QueryState
                    query={catalogs.resolvers}
                    loading={fieldSkeleton("Loading sources")}
                    errorMessage="Could not load the sources"
                  >
                    <SourceFields
                      idPrefix="new-session"
                      kindLabel="Primary source"
                      resolvers={resolvers}
                      value={{
                        resolverId: resolver?.id ?? null,
                        resolverConfig,
                      }}
                      onChange={(next) => {
                        setResolverId(next.resolverId === null ? "" : String(next.resolverId))
                        setResolverConfig(next.resolverConfig)
                      }}
                      browse={
                        canBrowse ? (
                          <div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              icon={<IconSearch size={15} />}
                              onClick={() => setBrowseOpen(true)}
                            >
                              Browse {resolver.name}…
                            </Button>
                          </div>
                        ) : undefined
                      }
                      disabled={create.isPending}
                    />
                  </QueryState>
                )}
              </>
            )}
          </TabPanel>

          {base === null ? (
            <div className="flex min-h-16 items-center rounded-sm border border-dashed border-line-subtle px-4 py-4 text-base text-ink-dim">
              {mode === "profile"
                ? "Pick a profile to see and edit the chain it falls back to."
                : "Pick an engine and a source to build its fallback chain."}
            </div>
          ) : (
            <ChainEditor
              idPrefix="new-session"
              catalog={catalog}
              base={base}
              value={chain}
              onChange={setChain}
              disabled={create.isPending}
            />
          )}

          <div className="flex flex-col gap-4">
            <Switch
              label="Record this session"
              checked={recording}
              onChange={(event) => setRecording(event.target.checked)}
            />

            <AccessCreation resourceType="session" onChange={setAccess} busy={create.isPending} />
          </div>
        </div>

        <DiscoveryDrawer
          open={browseOpen}
          onClose={() => setBrowseOpen(false)}
          resolver={resolver ?? null}
          onUse={(item) => {
            setResolverConfig(item.config ?? {})
            setBrowseOpen(false)
          }}
        />
      </Dialog>

      <ConfirmDialog
        open={discardOpen}
        onClose={() => setDiscardOpen(false)}
        title="Discard this new session?"
        description="Nothing has started yet. The fallbacks and access you set up here will be lost."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={() => {
          setDiscardOpen(false)
          onClose()
        }}
      />
    </>
  )
}
