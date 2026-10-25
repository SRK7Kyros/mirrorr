import { useEffect, useRef, useState } from "react"
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
import { FallbackProfiles } from "@/ui/views/autoruns/fallback-profiles"
import { FallbackSources, SourceFields } from "@/ui/views/shared/source-chain"
import type { FallbackSource } from "@/api/domain/fallback-sources"
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
  const [fallbackIds, setFallbackIds] = useState<number[]>([])
  const [fallbackSources, setFallbackSources] = useState<FallbackSource[]>([])
  const [browseOpen, setBrowseOpen] = useState(false)
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [access, setAccess] = useState<AccessTarget>({})
  const applyCreation = useCreationAccessApplier()

  const openedRef = useRef(false)

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
    setFallbackIds([])
    setFallbackSources([])
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
  const canBrowse = canBrowseResolver(resolver)
  const canSubmit = mode === "profile" ? profileId !== "" : engineId !== "" && resolverId !== ""

  const submit = () => {
    setError(null)
    const chain = fallbackIds.filter((id) => String(id) !== profileId)
    const body: SessionCreateBody =
      mode === "profile"
        ? {
            profile_id: Number(profileId),
            fallback_profile_ids: chain,
            recording,
          }
        : {
            engine_id: Number(engineId),
            resolver_id: Number(resolverId),
            resolver_config: resolverConfig,
            fallback_sources: fallbackSources,
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
                    setFallbackIds((previous) =>
                      previous.filter((id) => String(id) !== next),
                    )
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
              <FallbackProfiles
                profiles={profiles}
                primaryId={profileId}
                value={fallbackIds}
                onChange={setFallbackIds}
                disabled={create.isPending}
              />
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
              {engineId !== "" && resolverId !== "" ? (
                <FallbackSources
                  resolvers={resolvers}
                  value={fallbackSources}
                  onChange={setFallbackSources}
                  primary={
                    resolver === undefined
                      ? null
                      : { resolver_id: resolver.id, resolver_config: resolverConfig }
                  }
                  disabled={create.isPending}
                />
              ) : null}
            </>
          )}
        </TabPanel>

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
