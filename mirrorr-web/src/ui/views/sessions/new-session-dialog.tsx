import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  createSession,
  getErrorMessage,
  useEngines,
  useProfiles,
  useResolvers,
  type SessionCreateBody,
} from "@/api"
import { queryRoots } from "@/api/query-keys"
import {
  Banner,
  Button,
  Dialog,
  Field,
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
  normaliseRung,
  pruneChain,
  profileBase,
  resolveChain,
  sameChain,
  type ChainBase,
  type ChainCatalog,
  type FallbackRung,
} from "@/api/domain/fallback-chain"
import {
  AccessCreation,
  useCreationAccessApplier,
} from "@/ui/views/shared/resource-access-slot"
import type { AccessTarget } from "@/api/domain/access-plan"

export function NewSessionDialog({
  open,
  onClose,
}: {
  readonly open: boolean
  readonly onClose: () => void
}) {
  const queryClient = useQueryClient()
  const profiles = useProfiles()
  const engines = useEngines()
  const resolvers = useResolvers()

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
  const applyCreation = useCreationAccessApplier()

  const openedRef = useRef(false)

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
    setError(null)
    setMode(profiles.length > 0 ? "profile" : "custom")
    setProfileId("")
    setEngineId("")
    setResolverId("")
    setResolverConfig({})
    setChain([])
    setRecording(false)
    setAccess({})
  }, [open, profiles.length])

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

  // A rung that becomes a repeat when the capture before the chain moves — a
  // different profile, a different own source — is dropped rather than left to
  // block the save with a rung that can never advance.
  useEffect(() => {
    if (base === null) return
    setChain((previous) => {
      const next = pruneChain(previous, base, catalog)
      return sameChain(next, previous) ? previous : next
    })
  }, [base, catalog])

  const chainState = base === null ? null : resolveChain(chain, base, catalog)
  const canSubmit = chainState !== null && chainState.problem === null

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
    <Dialog
      open={open}
      onClose={onClose}
      title="New session"
      description="Start a capture now. A profile carries its own engine, resolver and retry policy."
      busy={create.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={create.isPending}
            disabled={!canSubmit}
            onClick={submit}
          >
            Start session
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error !== null ? <Banner kind="danger" title={error} /> : null}

        <Field label="Start from">
          <Segmented
            ariaLabel="Start from"
            panelId="new-session-mode"
            active={mode}
            onChange={setMode}
            items={[
              {
                id: "profile",
                label: "A profile",
                disabled: profiles.length === 0,
              },
              { id: "custom", label: "Engine + resolver" },
            ]}
          />
        </Field>

        <TabPanel panelId="new-session-mode" active={mode} className="flex flex-col gap-4">
          {mode === "profile" ? (
            <>
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
            </>
          ) : (
            <>
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
              {engineId === "" ? null : (
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
              )}
            </>
          )}
        </TabPanel>

        {base === null ? null : (
          <ChainEditor
            idPrefix="new-session"
            catalog={catalog}
            base={base}
            value={chain}
            onChange={setChain}
            disabled={create.isPending}
          />
        )}

        <Switch
          label="Record this session"
          checked={recording}
          onChange={(event) => setRecording(event.target.checked)}
        />

        <AccessCreation resourceType="session" onChange={setAccess} busy={create.isPending} />
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
  )
}
