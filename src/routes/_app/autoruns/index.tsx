import { createFileRoute } from "@tanstack/react-router"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { autorunsApi, profilesApi, pluginsApi, importExportApi } from "@/lib/api"
import type { Autorun, Profile } from "@/lib/schemas"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/status-badge"
import { InfoGrid } from "@/components/info-grid"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { DateTimePicker } from "@/components/datetime-picker"
import { TimeInput as RelativeTimeInput } from "@/components/masked-input"
import { EtaDisplay } from "@/components/eta-display"
import { Trash2, CalendarClock, Loader2, ArrowRight, ChevronDown, ChevronRight, Bookmark, Download } from "lucide-react"
import { formatLocalDate } from "@/lib/utils"
import { useState, useMemo, useEffect, useCallback } from "react"
import { useInterval } from "@/hooks/use-interval"
import { toast } from "sonner"
import { ImportDialog } from "@/components/import-dialog"
import { ImportButton, ExportButton } from "@/components/import-export-buttons"
import { FormField } from "@/components/form-field"
import { DynamicForm } from "@/components/dynamic-form"
import { SidebarLayout, SidebarEntry, DetailHeader, DetailLayout, CreatePanel, EmptyDetail, BulkActionBar, SidebarGroupContainer } from "@/components/resource-layout"
import { ResizableSidebar } from "@/components/resizable-sidebar"
import { MultiSelectProvider, useMultiSelect } from "@/hooks/use-multi-select"


export const Route = createFileRoute("/_app/autoruns/")({
  component: AutorunsPage,
})

function AutorunsPage() {
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importBundle, setImportBundle] = useState<Record<string, unknown> | null>(null)

  const { data: autoruns = [], isLoading } = useQuery({
    queryKey: ["autoruns"],
    queryFn: () => autorunsApi.list(),
  })

  const { data: profiles = [] } = useQuery({ queryKey: ["profiles"], queryFn: () => profilesApi.list() as Promise<any[]> })
  const { data: engines = [] } = useQuery({ queryKey: ["engines"], queryFn: () => pluginsApi.engines() as Promise<any[]> })

  const profileMap = useMemo(() => Object.fromEntries(profiles.map((p) => [p.id, p.name])), [profiles])
  const engineMap = useMemo(() => Object.fromEntries(engines.map((e) => [e.id, e.name])), [engines])

  const deleteMutation = useMutation({
    mutationFn: (id: number) => autorunsApi.delete(id),
    onSuccess: () => { toast.success("Autorun deleted") },
    onError: (err: Error) => toast.error(`Failed to delete autorun: ${err.message}`),
  })

  const autorunIds = autoruns.map((a) => a.id)

  return (
    <ResizableSidebar>
      <MultiSelectProvider allIds={autorunIds}>
        <SidebarLayout
          title="Autoruns"
          count={autoruns.length}
          countLabel="scheduled"
          onNew={() => setShowCreate(true)}
          isLoading={isLoading}
          emptyText="No autoruns"
          sidebarActions={
            <ImportButton onBundle={(bundle) => { setImportBundle(bundle); setImportOpen(true) }} />
          }
          className="bg-card border rounded-xl h-full"
        >
          <SidebarGroupContainer>
          {autoruns.map((a) => (
            <SidebarEntry key={a.id} id={a.id} onClick={() => { setSelectedId(a.id); setShowCreate(false) }} className="relative">
              <div className="absolute top-2 right-2"><StatusBadge status={a.status ?? "scheduled"} /></div>
              <div className="text-[13px] font-medium truncate pr-20">{a.user_friendly_name}</div>
              <div className="flex items-center gap-1.5 mt-1 text-[10px] text-muted-foreground/60">
                <span>{formatLocalDate(a.start_time, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</span>
                <ArrowRight className="size-3" />
                <span>{formatLocalDate(a.end_time, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</span>
              </div>
            </SidebarEntry>
          ))}
          </SidebarGroupContainer>
        </SidebarLayout>
        <BulkActionBar actions={<BulkActions />} />
      </MultiSelectProvider>
      {showCreate ? (
        <CreateAutorunPanel onClose={() => setShowCreate(false)} />
      ) : selectedId ? (
        <AutorunDetail autorun={autoruns.find((a) => a.id === selectedId)} onBack={() => setSelectedId(null)}
          onDelete={() => { deleteMutation.mutate(selectedId); setSelectedId(null) }}
          deleting={deleteMutation.isPending}
          profileMap={profileMap} engineMap={engineMap}
        />
      ) : (
        <EmptyDetail icon={CalendarClock} text="Select an autorun" />
      )}
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImported={() => queryClient.invalidateQueries({ queryKey: ["autoruns"] })} bundle={importBundle} />
    </ResizableSidebar>
  )
}

function BulkActions() {
  const multi = useMultiSelect()
  const deleteMutation = useMutation({
    mutationFn: async (ids: number[]) => { for (const id of ids) await autorunsApi.delete(id) },
    onSuccess: () => { multi.clear(); toast.success("Autoruns deleted") },
    onError: (err: Error) => toast.error(`Failed to delete autoruns: ${err.message}`),
  })
  const handleExport = async () => {
    const ids = [...multi.selectedIds]
    try {
      for (const id of ids) {
        const bundle = await importExportApi.exportAutorun(id)
        const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `autorun-${id}-export.json`
        a.click()
        URL.revokeObjectURL(url)
      }
      toast.success(`Exported ${ids.length} autorun(s)`)
      multi.clear()
    } catch (err: any) {
      toast.error(`Export failed: ${err.message}`)
    }
  }
  return (
    <>
      <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={handleExport}>
        <Download className="size-3 mr-1" />Bulk Export
      </Button>
      <Button variant="ghost" size="sm" className="h-6 text-[10px] text-destructive hover:text-destructive" onClick={() => deleteMutation.mutate([...multi.selectedIds])} disabled={deleteMutation.isPending}>
        {deleteMutation.isPending ? <Loader2 className="size-3 mr-1 animate-spin" /> : <Trash2 className="size-3 mr-1" />}Bulk Delete
      </Button>
    </>
  )
}

function AutorunDetail({ autorun, onBack, onDelete, deleting, profileMap, engineMap }: { autorun: Autorun | undefined; onBack: () => void; onDelete: () => void; deleting: boolean; profileMap: Record<number, string>; engineMap: Record<number, string> }) {
  const queryClient = useQueryClient()
  const { data: resolvers = [] } = useQuery({ queryKey: ["resolvers"], queryFn: () => pluginsApi.resolvers() as Promise<any[]> })
  const { data: profiles = [] } = useQuery({ queryKey: ["profiles"], queryFn: () => profilesApi.list() as Promise<any[]> })

  const [saveName, setSaveName] = useState("")
  const [saveOpen, setSaveOpen] = useState(false)

  const saveAsProfileMutation = useMutation({
    mutationFn: ({ autorunId, name }: { autorunId: number; name: string }) =>
      autorunsApi.saveAsProfile(autorunId, name),
    onSuccess: () => {
      setSaveOpen(false)
      setSaveName("")
      queryClient.invalidateQueries({ queryKey: ["profiles"] })
      toast.success("Profile created from autorun")
    },
    onError: (err: Error) =>
      toast.error(`Failed to save as profile: ${err.message}`),
  })

  const profile = profiles.find((p) => p.id === autorun?.profile_id)
  const resolver = resolvers.find((r) => r.id === autorun?.resolver_id)

  if (!autorun) return null
  return (
    <DetailLayout
      header={
        <DetailHeader
          onBack={onBack}
          title={autorun.user_friendly_name}
          actions={
            <div className="flex items-center gap-1">
              {/* Save as Profile — only when autorun has no profile */}
              {!autorun.profile_id && (
                saveOpen ? (
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={saveName}
                      onChange={(e) => setSaveName(e.target.value)}
                      className="h-7 text-[11px] w-36"
                      placeholder="Profile name"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && saveName.trim()) {
                          saveAsProfileMutation.mutate({ autorunId: autorun.id, name: saveName.trim() })
                        } else if (e.key === "Escape") {
                          setSaveOpen(false)
                          setSaveName("")
                        }
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-[11px]"
                      disabled={!saveName.trim() || saveAsProfileMutation.isPending}
                      onClick={() => saveAsProfileMutation.mutate({ autorunId: autorun.id, name: saveName.trim() })}
                    >
                      {saveAsProfileMutation.isPending ? <Loader2 className="size-3 mr-1 animate-spin" /> : <Bookmark className="size-3 mr-1" />}
                      Save
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-[11px]"
                      onClick={() => { setSaveOpen(false); setSaveName("") }}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() => setSaveOpen(true)}
                  >
                    <Bookmark className="size-3 mr-1" />
                    Save as Profile
                  </Button>
                )
              )}
              <ExportButton onExport={() => importExportApi.exportAutorun(autorun.id)} filename={autorun.user_friendly_name} />
              <Button variant="ghost" size="sm" className="h-7 text-[11px] text-destructive" onClick={onDelete} disabled={deleting}>{deleting ? <Loader2 className="size-3 mr-1 animate-spin" /> : <Trash2 className="size-3 mr-1" />}Delete</Button>
            </div>
          }
        />
      }
    >
      <InfoGrid fields={[
        { label: "Status", value: <StatusBadge status={autorun.status ?? "scheduled"} /> },
        { label: "Name", value: autorun.user_friendly_name },
        { label: "Profile", value: profileMap[autorun.profile_id] ?? `#${autorun.profile_id}` },
        { label: "Engine", value: engineMap[autorun.engine_id] ?? `#${autorun.engine_id}` },
        { label: "Resolver", value: resolver?.name ?? `#${autorun.resolver_id ?? "?"}` },
        { label: "Retry Mode", value: autorun.retry_mode ?? "none" },
      ]} />
      <div className="flex gap-4">
        {autorun.start_time && <div className="space-y-1 shrink-0"><Label className="text-[11px] text-muted-foreground">Start Time</Label><p className="text-xs">{formatLocalDate(autorun.start_time)}</p></div>}
        {autorun.end_time && <div className="space-y-1 shrink-0"><Label className="text-[11px] text-muted-foreground">End Time</Label><p className="text-xs">{formatLocalDate(autorun.end_time)}</p></div>}
      </div>
    </DetailLayout>
  )
}

function CreateAutorunPanel({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState("")
  const [profileId, setProfileId] = useState("__none__")
  const [engineId, setEngineId] = useState("")
  const [resolverId, setResolverId] = useState("")
  const [retryMode, setRetryMode] = useState("none")
  const [retryConfig, setRetryConfig] = useState<Record<string, unknown>>({})
  const [resolverConfig, setResolverConfig] = useState<Record<string, unknown>>({})
  const [recording, setRecording] = useState(true)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [timeMode, setTimeMode] = useState<"pick" | "relative">("pick")
  const [startTime, setStartTime] = useState("")
  const [endTime, setEndTime] = useState("")
  const [relativeStartOffset, setRelativeStartOffset] = useState<number>(0)
  const [relativeEndOffset, setRelativeEndOffset] = useState<number>(0)
  const [now, setNow] = useState(() => Date.now())

  useInterval(() => setNow(Date.now()), 1000)

  const { data: profiles = [] } = useQuery({ queryKey: ["profiles"], queryFn: () => profilesApi.list() as Promise<Profile[]> })
  const { data: engines = [] } = useQuery({ queryKey: ["engines"], queryFn: () => pluginsApi.engines() as Promise<any[]> })
  const { data: resolvers = [] } = useQuery({ queryKey: ["resolvers"], queryFn: () => pluginsApi.resolvers() as Promise<any[]> })

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
    if (profile) {
      fillFromProfile(profile)
    }
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

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => autorunsApi.create(data as any),
    onSuccess: () => {
      onClose()
      queryClient.invalidateQueries({ queryKey: ["autoruns"] })
      toast.success("Autorun created")
    },
    onError: (err: Error) => toast.error(`Failed to create autorun: ${err.message}`),
  })

  const getStartTime = () => timeMode === "relative" ? new Date(now + relativeStartOffset).toISOString() : startTime
  const getEndTime = () => timeMode === "relative" ? new Date(now + relativeEndOffset).toISOString() : endTime

  const hasProfile = profileId && profileId !== "__none__"
  const showConfigFields = !hasProfile || advancedOpen

  const canSubmit = showConfigFields
    ? !!(name && engineId && resolverId && getStartTime() && getEndTime())
    : !!(name && hasProfile && getStartTime() && getEndTime())

  return (
    <CreatePanel
      title="New Autorun"
      onClose={onClose}
      submitLabel="Create Autorun"
      onSubmit={() => {
        const data: Record<string, unknown> = {
          user_friendly_name: name,
          snake_case_name: name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""),
          recording,
          start_time: getStartTime(),
          end_time: getEndTime(),
        }
        if (hasProfile) data.profile_id = parseInt(profileId)
        if (showConfigFields) {
          if (engineId) data.engine_id = parseInt(engineId)
          if (resolverId) data.resolver_id = parseInt(resolverId)
          data.retry_mode = retryMode
          data.retry_config = retryConfig
          data.resolver_config = resolverConfig
        } else if (selectedProfile) {
          data.engine_id = selectedProfile.default_engine_id
          data.resolver_id = selectedProfile.resolver_id
          data.retry_mode = selectedProfile.retry_mode ?? "none"
          data.retry_config = selectedProfile.retry_config ?? {}
          data.resolver_config = selectedProfile.resolver_config ?? {}
        }
        createMutation.mutate(data)
      }}
      isPending={createMutation.isPending}
      canSubmit={canSubmit}
    >
      {/* Name */}
      <FormField label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-xs" placeholder="My Stream" />
      </FormField>

      {/* Profile selector */}
      <FormField label="Profile">
        <Select
          value={profileId}
          onValueChange={handleProfileChange}
          items={[
            { value: "__none__", label: "None — configure manually" },
            ...profiles.map((p) => ({ value: String(p.id), label: p.name })),
          ]}
        >
          <SelectTrigger className="h-8 text-xs w-full">
            <SelectValue placeholder="None — configure manually" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">None — configure manually</SelectItem>
            {profiles.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

      {/* Advanced toggle — only when profile selected */}
      {hasProfile && (
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {advancedOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
              Advanced — override profile settings
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 mt-2">
            <AutorunConfigFields
              engineId={engineId}
              resolverId={resolverId}
              retryMode={retryMode}
              retryConfig={retryConfig}
              resolverConfig={resolverConfig}
              availableRetryModes={availableRetryModes}
              retryModeSchema={retryModeSchema}
              resolverConfigSchema={resolverConfigSchema}
              engines={engines}
              resolvers={resolvers}
              onEngineChange={handleEngineChange}
              onResolverChange={(v) => { setResolverId(v); setResolverConfig({}) }}
              onRetryModeChange={handleRetryModeChange}
              onRetryConfigChange={setRetryConfig}
              onResolverConfigChange={setResolverConfig}
            />
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Config fields — when no profile selected */}
      {!hasProfile && (
        <AutorunConfigFields
          engineId={engineId}
          resolverId={resolverId}
          retryMode={retryMode}
          retryConfig={retryConfig}
          resolverConfig={resolverConfig}
          availableRetryModes={availableRetryModes}
          retryModeSchema={retryModeSchema}
          resolverConfigSchema={resolverConfigSchema}
          engines={engines}
          resolvers={resolvers}
          onEngineChange={handleEngineChange}
          onResolverChange={(v) => { setResolverId(v); setResolverConfig({}) }}
          onRetryModeChange={handleRetryModeChange}
          onRetryConfigChange={setRetryConfig}
          onResolverConfigChange={setResolverConfig}
        />
      )}

      {/* Recording toggle */}
      <div className="flex items-center justify-between">
        <Label className="text-[11px]">Recording</Label>
        <Switch checked={recording} onCheckedChange={setRecording} />
      </div>

      {/* Schedule */}
      <div className="flex flex-col gap-3">
        <Label className="text-[11px] font-medium">Schedule</Label>
        <Tabs value={timeMode} onValueChange={(v) => setTimeMode(v as "pick" | "relative")}>
          <TabsList className="h-7">
            <TabsTrigger value="pick" className="text-[11px] h-6">Pick Date & Time</TabsTrigger>
            <TabsTrigger value="relative" className="text-[11px] h-6">Relative Duration</TabsTrigger>
          </TabsList>
          <TabsContent value="pick" className="space-y-3 mt-3">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Start"><DateTimePicker value={startTime} onChange={setStartTime} />{startTime && <EtaDisplay value={startTime} mode="relative" className="text-[10px] text-muted-foreground/70 italic" />}</FormField>
              <FormField label="End"><DateTimePicker value={endTime} onChange={setEndTime} />{endTime && <EtaDisplay value={endTime} mode="relative" className="text-[10px] text-muted-foreground/70 italic" />}</FormField>
            </div>
          </TabsContent>
          <TabsContent value="relative" className="space-y-3 mt-3">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Start (relative)"><RelativeTimeInput format="MM-DD-HH:mm:ss" value={null} onChange={setRelativeStartOffset} />{relativeStartOffset > 0 && <EtaDisplay value={new Date(now + relativeStartOffset).toISOString()} mode="relative" className="text-[10px] text-muted-foreground/70 italic" />}</FormField>
              <FormField label="End (relative)"><RelativeTimeInput format="MM-DD-HH:mm:ss" value={null} onChange={setRelativeEndOffset} />{relativeEndOffset > 0 && <EtaDisplay value={new Date(now + relativeEndOffset).toISOString()} mode="relative" className="text-[10px] text-muted-foreground/70 italic" />}</FormField>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </CreatePanel>
  )
}

/** Config fields for autorun creation — engine, resolver, retry mode, and dynamic forms */
function AutorunConfigFields({
  engineId, resolverId, retryMode, retryConfig, resolverConfig,
  availableRetryModes, retryModeSchema, resolverConfigSchema,
  engines, resolvers,
  onEngineChange, onResolverChange, onRetryModeChange,
  onRetryConfigChange, onResolverConfigChange,
}: {
  engineId: string
  resolverId: string
  retryMode: string
  retryConfig: Record<string, unknown>
  resolverConfig: Record<string, unknown>
  availableRetryModes: string[]
  retryModeSchema: any
  resolverConfigSchema: any
  engines: any[]
  resolvers: any[]
  onEngineChange: (v: string) => void
  onResolverChange: (v: string) => void
  onRetryModeChange: (v: string) => void
  onRetryConfigChange: (v: Record<string, unknown>) => void
  onResolverConfigChange: (v: Record<string, unknown>) => void
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 items-end">
        <div className="grid grid-cols-2 gap-2">
          <FormField label="Engine">
            <Select value={engineId} onValueChange={onEngineChange} items={engines.map((e: any) => ({ value: String(e.id), label: e.name }))}>
              <SelectTrigger className="h-8 text-xs w-full"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>{engines.map((e: any) => <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>)}</SelectContent>
            </Select>
          </FormField>
          <FormField label="Retry Mode">
            <Select value={retryMode} onValueChange={onRetryModeChange} disabled={!engineId} items={availableRetryModes.map((m: string) => ({ value: m, label: m }))}>
              <SelectTrigger className="h-8 text-xs w-full"><SelectValue placeholder={engineId ? "Select" : "—"} /></SelectTrigger>
              <SelectContent>{availableRetryModes.map((m: string) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </FormField>
        </div>
        <FormField label="Resolver">
          <Select value={resolverId} onValueChange={onResolverChange} items={resolvers.map((r: any) => ({ value: String(r.id), label: r.name }))}>
            <SelectTrigger className="h-8 text-xs w-full"><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>{resolvers.map((r: any) => <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>)}</SelectContent>
          </Select>
        </FormField>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {retryModeSchema && (
          <div className="rounded-lg border bg-muted/10 p-3 space-y-3">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">Retry Config</p>
            <DynamicForm schema={retryModeSchema} value={retryConfig} onChange={onRetryConfigChange} />
          </div>
        )}
        {resolverConfigSchema && (
          <div className="rounded-lg border bg-muted/10 p-3 space-y-3">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">Resolver Config</p>
            <DynamicForm schema={resolverConfigSchema} value={resolverConfig} onChange={onResolverConfigChange} />
          </div>
        )}
      </div>
    </>
  )
}
