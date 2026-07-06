/**
 * Shared plugin configuration hook.
 * Encapsulates the engine/resolver/retry/profile selection state
 * and derivation logic duplicated across sessions, autoruns, and profiles create panels.
 */
import { useState, useMemo, useCallback } from "react"
import type { Profile } from "@/lib/schemas"
import { useEngines, useResolvers, useProfiles } from "@/hooks/use-queries"

export function usePluginConfig() {
  const { data: profiles = [] } = useProfiles()
  const { data: engines = [] } = useEngines()
  const { data: resolvers = [] } = useResolvers()

  const [profileId, setProfileId] = useState("__none__")
  const [engineId, setEngineId] = useState("")
  const [resolverId, setResolverId] = useState("")
  const [retryMode, setRetryMode] = useState("none")
  const [retryConfig, setRetryConfig] = useState<Record<string, unknown>>({})
  const [resolverConfig, setResolverConfig] = useState<Record<string, unknown>>({})
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.id === parseInt(profileId)),
    [profileId, profiles],
  )

  const selectedEngine = useMemo(() => {
    if (!engineId) return null
    return engines.find((e) => e.id === parseInt(engineId)) ?? null
  }, [engineId, engines])

  const selectedResolver = useMemo(() => {
    if (!resolverId) return null
    return resolvers.find((r) => r.id === parseInt(resolverId)) ?? null
  }, [resolverId, resolvers])

  const resolverConfigSchema = useMemo(() => {
    if (!selectedResolver?.config_schema) return null
    return selectedResolver.config_schema
  }, [selectedResolver])

  const availableRetryModes = useMemo(() => {
    if (!selectedEngine?.retry_modes_schema) return ["none"]
    return Object.keys(selectedEngine.retry_modes_schema)
  }, [selectedEngine])

  const retryModeSchema = useMemo(() => {
    if (!selectedEngine?.retry_modes_schema) return null
    const modeData = selectedEngine.retry_modes_schema[retryMode]
    if (!modeData?.schema?.properties || Object.keys(modeData.schema.properties).length === 0) return null
    return modeData.schema
  }, [selectedEngine, retryMode])

  const fillFromProfile = useCallback((profile: Profile) => {
    setEngineId(String(profile.default_engine_id))
    setResolverId(String(profile.resolver_id))
    setRetryMode(profile.retry_mode ?? "none")
    setRetryConfig(profile.retry_config ?? {})
    setResolverConfig(profile.resolver_config ?? {})
  }, [])

  const handleProfileChange = useCallback((v: string) => {
    setProfileId(v)
    if (v === "__none__") {
      setEngineId("")
      setResolverId("")
      setRetryMode("none")
      setRetryConfig({})
      setResolverConfig({})
      return
    }
    const profile = profiles.find((p) => p.id === parseInt(v))
    if (profile) fillFromProfile(profile)
    setAdvancedOpen(false)
  }, [profiles, fillFromProfile])

  const handleEngineChange = useCallback((v: string) => {
    setEngineId(v)
    setRetryMode("none")
    setRetryConfig({})
  }, [])

  const handleRetryModeChange = useCallback((mode: string) => {
    setRetryMode(mode)
    if (!selectedEngine?.retry_modes_schema) { setRetryConfig({}); return }
    const modeData = selectedEngine.retry_modes_schema[mode]
    if (modeData?.default_params) {
      setRetryConfig({ ...modeData.default_params })
    } else {
      setRetryConfig({})
    }
  }, [selectedEngine])

  const handleResolverChange = useCallback((v: string) => {
    setResolverId(v)
    setResolverConfig({})
  }, [])

  const hasProfile = profileId && profileId !== "__none__"
  const showConfigFields = !hasProfile || advancedOpen

  return {
    // Data
    profiles,
    engines,
    resolvers,
    // State
    profileId,
    setProfileId,
    engineId,
    resolverId,
    retryMode,
    retryConfig,
    setRetryConfig,
    resolverConfig,
    setResolverConfig,
    advancedOpen,
    setAdvancedOpen,
    // Derived
    selectedProfile,
    selectedEngine,
    selectedResolver,
    resolverConfigSchema,
    availableRetryModes,
    retryModeSchema,
    hasProfile,
    showConfigFields,
    // Handlers
    handleProfileChange,
    handleEngineChange,
    handleRetryModeChange,
    handleResolverChange,
  }
}
