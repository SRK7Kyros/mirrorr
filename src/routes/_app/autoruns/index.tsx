import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { autorunsApi, importExportApi } from "@/lib/api"
import type { Autorun } from "@/lib/schemas"
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
import { Trash2, CalendarClock, Loader2, ArrowRight, ChevronDown, ChevronRight, Download } from "lucide-react"
import { formatLocalDate } from "@/lib/utils"
import { useState, useMemo } from "react"
import { useInterval } from "@/hooks/use-interval"
import { toast } from "sonner"
import { ImportDialog } from "@/components/import-dialog"
import { ImportButton, ExportButton } from "@/components/import-export-buttons"
import { FormField } from "@/components/form-field"
import { SidebarLayout, SidebarEntry, DetailHeader, DetailLayout, CreatePanel, EmptyDetail, BulkActionBar, SidebarGroupContainer } from "@/components/resource-layout"
import { ResizableSidebar } from "@/components/resizable-sidebar"
import { MultiSelectProvider } from "@/hooks/use-multi-select"
import { usePluginConfig } from "@/hooks/use-plugin-config"
import { useBulkDelete } from "@/hooks/use-bulk-delete"
import { useSaveAsProfile } from "@/hooks/use-save-as-profile"
import { PluginConfigFields } from "@/components/config-fields"
import { useAutoruns, useProfiles, useEngines, useResolvers } from "@/hooks/use-queries"
import { SaveAsProfileButton } from "@/components/save-as-profile-button"


export const Route = createFileRoute("/_app/autoruns/")({
  component: AutorunsPage,
})

function AutorunsPage() {
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importBundle, setImportBundle] = useState<Record<string, unknown> | null>(null)

  const { data: autoruns = [], isLoading } = useAutoruns()

  const { data: profiles = [] } = useProfiles()
  const { data: engines = [] } = useEngines()

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
  const { mutate: deleteMutate, isPending: deletePending } = useBulkDelete(
    (id: number) => autorunsApi.delete(id),
    "Autoruns",
  )
  const { handleExport } = useBulkExport(
    (id: number) => importExportApi.exportAutorun(id),
    "autorun",
    "autorun",
  )
  return (
    <>
      <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={handleExport}>
        <Download className="size-3 mr-1" />Bulk Export
      </Button>
      <Button variant="ghost" size="sm" className="h-6 text-[10px] text-destructive hover:text-destructive" onClick={deleteMutate} disabled={deletePending}>
        {deletePending ? <Loader2 className="size-3 mr-1 animate-spin" /> : <Trash2 className="size-3 mr-1" />}Bulk Delete
      </Button>
    </>
  )
}

function AutorunDetail({ autorun, onBack, onDelete, deleting, profileMap, engineMap }: { autorun: Autorun | undefined; onBack: () => void; onDelete: () => void; deleting: boolean; profileMap: Record<number, string>; engineMap: Record<number, string> }) {
  const { data: resolvers = [] } = useResolvers()

  const saveAsProfile = useSaveAsProfile(
    (autorunId: number, name: string) => autorunsApi.saveAsProfile(autorunId, name),
    "autorun",
  )

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
              {!autorun.profile_id && (
                <SaveAsProfileButton
                  open={saveAsProfile.open}
                  onOpen={() => saveAsProfile.setOpen(true)}
                  name={saveAsProfile.name}
                  onNameChange={saveAsProfile.setName}
                  onSave={() => saveAsProfile.save(autorun.id)}
                  onCancel={() => { saveAsProfile.setOpen(false); saveAsProfile.setName("") }}
                  isPending={saveAsProfile.isPending}
                />
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
  const config = usePluginConfig()
  const [name, setName] = useState("")
  const [recording, setRecording] = useState(true)
  const [timeMode, setTimeMode] = useState<"pick" | "relative">("pick")
  const [startTime, setStartTime] = useState("")
  const [endTime, setEndTime] = useState("")
  const [relativeStartOffset, setRelativeStartOffset] = useState<number>(0)
  const [relativeEndOffset, setRelativeEndOffset] = useState<number>(0)
  const [now, setNow] = useState(() => Date.now())

  useInterval(() => setNow(Date.now()), 1000)

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

  const canSubmit = config.showConfigFields
    ? !!(name && config.engineId && config.resolverId && getStartTime() && getEndTime())
    : !!(name && config.hasProfile && getStartTime() && getEndTime())

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
        if (config.hasProfile) data.profile_id = parseInt(config.profileId)
        if (config.showConfigFields) {
          if (config.engineId) data.engine_id = parseInt(config.engineId)
          if (config.resolverId) data.resolver_id = parseInt(config.resolverId)
          data.retry_mode = config.retryMode
          data.retry_config = config.retryConfig
          data.resolver_config = config.resolverConfig
        } else if (config.selectedProfile) {
          data.engine_id = config.selectedProfile.default_engine_id
          data.resolver_id = config.selectedProfile.resolver_id
          data.retry_mode = config.selectedProfile.retry_mode ?? "none"
          data.retry_config = config.selectedProfile.retry_config ?? {}
          data.resolver_config = config.selectedProfile.resolver_config ?? {}
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
          value={config.profileId}
          onValueChange={config.handleProfileChange}
          items={[
            { value: "__none__", label: "None — configure manually" },
            ...config.profiles.map((p) => ({ value: String(p.id), label: p.name })),
          ]}
        >
          <SelectTrigger className="h-8 text-xs w-full">
            <SelectValue placeholder="None — configure manually" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">None — configure manually</SelectItem>
            {config.profiles.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

      {/* Advanced toggle — only when profile selected */}
      {config.hasProfile && (
        <Collapsible open={config.advancedOpen} onOpenChange={config.setAdvancedOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {config.advancedOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
              Advanced — override profile settings
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 mt-2">
            <PluginConfigFields
              engineId={config.engineId} resolverId={config.resolverId}
              retryMode={config.retryMode} retryConfig={config.retryConfig} resolverConfig={config.resolverConfig}
              availableRetryModes={config.availableRetryModes} retryModeSchema={config.retryModeSchema} resolverConfigSchema={config.resolverConfigSchema}
              engines={config.engines} resolvers={config.resolvers}
              onEngineChange={config.handleEngineChange} onResolverChange={config.handleResolverChange}
              onRetryModeChange={config.handleRetryModeChange} onRetryConfigChange={config.setRetryConfig} onResolverConfigChange={config.setResolverConfig}
            />
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Config fields — when no profile selected */}
      {!config.hasProfile && (
        <PluginConfigFields
          engineId={config.engineId} resolverId={config.resolverId}
          retryMode={config.retryMode} retryConfig={config.retryConfig} resolverConfig={config.resolverConfig}
          availableRetryModes={config.availableRetryModes} retryModeSchema={config.retryModeSchema} resolverConfigSchema={config.resolverConfigSchema}
          engines={config.engines} resolvers={config.resolvers}
          onEngineChange={config.handleEngineChange} onResolverChange={config.handleResolverChange}
          onRetryModeChange={config.handleRetryModeChange} onRetryConfigChange={config.setRetryConfig} onResolverConfigChange={config.setResolverConfig}
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
