import { createFileRoute } from "@tanstack/react-router"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { profilesApi, pluginsApi, importExportApi } from "@/lib/api"
import type { Profile } from "@/lib/schemas"
import { KeyValueTable } from "@/components/key-value-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DynamicForm } from "@/components/dynamic-form"
import { Trash2, Settings, Cpu, Zap, Loader2, Download } from "lucide-react"
import { useState, useMemo } from "react"
import { toast } from "sonner"
import { ImportDialog } from "@/components/import-dialog"
import { ImportButton, ExportButton } from "@/components/import-export-buttons"
import { InfoGrid } from "@/components/info-grid"
import { FormField } from "@/components/form-field"
import { SidebarLayout, SidebarEntry, DetailHeader, DetailLayout, CreatePanel, EmptyDetail, BulkActionBar, SidebarGroupContainer } from "@/components/resource-layout"
import { ResizableSidebar } from "@/components/resizable-sidebar"
import { MultiSelectProvider, useMultiSelect } from "@/hooks/use-multi-select"


export const Route = createFileRoute("/_app/profiles/")({
  component: ProfilesPage,
})

function ProfilesPage() {
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importBundle, setImportBundle] = useState<Record<string, unknown> | null>(null)

  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ["profiles"],
    queryFn: () => profilesApi.list(),
  })

  const { data: engines = [] } = useQuery({
    queryKey: ["engines"],
    queryFn: () => pluginsApi.engines(),
  })

  const { data: resolvers = [] } = useQuery({
    queryKey: ["resolvers"],
    queryFn: () => pluginsApi.resolvers(),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => profilesApi.delete(id),
    onSuccess: () => { toast.success("Profile deleted") },
    onError: (err: Error) => toast.error(`Failed to delete profile: ${err.message}`),
  })

  const profileIds = profiles.map((p) => p.id)

  return (
    <ResizableSidebar>
      <MultiSelectProvider allIds={profileIds}>
        <SidebarLayout
          title="Profiles"
          count={profiles.length}
          countLabel="profiles"
          onNew={() => setShowCreate(true)}
          isLoading={isLoading}
          emptyText="No profiles"
          sidebarActions={
            <ImportButton onBundle={(bundle) => { setImportBundle(bundle); setImportOpen(true) }} />
          }
          className="bg-card border rounded-xl h-full"
        >
          <SidebarGroupContainer>
          {profiles.map((p) => (
            <SidebarEntry key={p.id} id={p.id} onClick={() => { setSelectedId(p.id); setShowCreate(false) }}>
              <div className="flex items-center gap-2 w-full">
                <div className="text-[13px] font-medium truncate">{p.name}</div>
                <InlineDeleteButton id={p.id} deleteMutation={deleteMutation} />
              </div>
              <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground/60">
                <span className="flex items-center gap-0.5"><Cpu className="size-3" />{engines.find((e) => e.id === p.default_engine_id)?.name ?? `Engine #${p.default_engine_id}`}</span>
                <span className="flex items-center gap-0.5"><Zap className="size-3" />{resolvers.find((r) => r.id === p.resolver_id)?.name ?? `Resolver #${p.resolver_id}`}</span>
              </div>
            </SidebarEntry>
          ))}
          </SidebarGroupContainer>
        </SidebarLayout>
        <BulkActionBar actions={<BulkActions />} />
      </MultiSelectProvider>
      {showCreate ? (
        <CreateProfilePanel onClose={() => setShowCreate(false)} />
      ) : selectedId ? (
        <ProfileDetail profile={profiles.find((p) => p.id === selectedId)} onBack={() => setSelectedId(null)}
          onDelete={() => { deleteMutation.mutate(selectedId); setSelectedId(null) }}
          deleting={deleteMutation.isPending}
        />
      ) : (
        <EmptyDetail icon={Settings} text="Select a profile" />
      )}
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImported={() => queryClient.invalidateQueries({ queryKey: ["profiles"] })} bundle={importBundle} />
    </ResizableSidebar>
  )
}

function InlineDeleteButton({ id, deleteMutation }: { id: number; deleteMutation: any }) {
  return (
    <Button variant="ghost" size="icon-xs" className="ml-auto shrink-0 opacity-0 group-hover:opacity-100 hover:text-destructive" onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(id) }} disabled={deleteMutation.isPending && deleteMutation.variables === id}>
      {deleteMutation.isPending && deleteMutation.variables === id ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
    </Button>
  )
}

function BulkActions() {
  const multi = useMultiSelect()
  const deleteMutation = useMutation({
    mutationFn: async (ids: number[]) => { for (const id of ids) await profilesApi.delete(id) },
    onSuccess: () => { multi.clear(); toast.success("Profiles deleted") },
    onError: (err: Error) => toast.error(`Failed to delete profiles: ${err.message}`),
  })
  const handleExport = async () => {
    const ids = [...multi.selectedIds]
    try {
      for (const id of ids) {
        const bundle = await importExportApi.exportProfile(id)
        const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `profile-${id}-export.json`
        a.click()
        URL.revokeObjectURL(url)
      }
      toast.success(`Exported ${ids.length} profile(s)`)
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

function ProfileDetail({ profile, onBack, onDelete, deleting }: { profile: Profile | undefined; onBack: () => void; onDelete: () => void; deleting: boolean }) {
  const { data: engines = [] } = useQuery({ queryKey: ["engines"], queryFn: () => pluginsApi.engines() as Promise<any[]> })
  const { data: resolvers = [] } = useQuery({ queryKey: ["resolvers"], queryFn: () => pluginsApi.resolvers() as Promise<any[]> })

  if (!profile) return null
  const engine = engines.find((e) => e.id === profile.default_engine_id)
  const resolver = resolvers.find((r) => r.id === profile.resolver_id)
  return (
    <DetailLayout
      header={
        <DetailHeader
          onBack={onBack}
          title={profile.name}
          actions={
            <div className="flex items-center gap-1">
              <ExportButton onExport={() => importExportApi.exportProfile(profile.id)} filename={profile.name} />
              <Button variant="ghost" size="sm" className="h-7 text-[11px] text-destructive" onClick={onDelete} disabled={deleting}>{deleting ? <Loader2 className="size-3 mr-1 animate-spin" /> : <Trash2 className="size-3 mr-1" />}Delete</Button>
            </div>
          }
        />
      }
    >
      <InfoGrid
        fields={[
          { label: "Name", value: profile.name },
          { label: "Retry Mode", value: profile.retry_mode ?? "none" },
          { label: "Engine", value: engine?.name ?? `#${profile.default_engine_id}` },
          { label: "Resolver", value: resolver?.name ?? `#${profile.resolver_id}` },
        ]}
      />
      <KeyValueTable title="Resolver Config" entries={Object.entries(profile.resolver_config ?? {})} json={profile.resolver_config} emptyText="None" />
      <KeyValueTable title="Retry Config" entries={Object.entries(profile.retry_config ?? {})} json={profile.retry_config} emptyText="None" />
    </DetailLayout>
  )
}

function CreateProfilePanel({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("")
  const [engineId, setEngineId] = useState("")
  const [resolverId, setResolverId] = useState("")
  const [retryMode, setRetryMode] = useState("none")
  const [retryConfig, setRetryConfig] = useState<Record<string, unknown>>({})
  const [resolverConfig, setResolverConfig] = useState<Record<string, unknown>>({})

  const { data: engines = [] } = useQuery({ queryKey: ["engines"], queryFn: () => pluginsApi.engines() as Promise<any[]> })
  const { data: resolvers = [] } = useQuery({ queryKey: ["resolvers"], queryFn: () => pluginsApi.resolvers() as Promise<any[]> })

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

  // Retry modes from the selected engine
  const availableRetryModes = useMemo(() => {
    if (!selectedEngine?.retry_modes_schema) return []
    return Object.keys(selectedEngine.retry_modes_schema)
  }, [selectedEngine])

  // Schema for the current retry mode's parameters
  const retryModeSchema = useMemo(() => {
    if (!selectedEngine?.retry_modes_schema) return null
    const modeData = selectedEngine.retry_modes_schema[retryMode]
    if (!modeData?.schema?.properties || Object.keys(modeData.schema.properties).length === 0) return null
    return modeData.schema
  }, [selectedEngine, retryMode])

  // Pre-fill defaults when retry mode changes
  const handleRetryModeChange = (mode: string) => {
    setRetryMode(mode)
    if (!selectedEngine?.retry_modes_schema) { setRetryConfig({}); return }
    const modeData = selectedEngine.retry_modes_schema[mode]
    if (modeData?.default_params) {
      setRetryConfig({ ...modeData.default_params })
    } else {
      setRetryConfig({})
    }
  }

  // Reset retry state when engine changes
  const handleEngineChange = (v: string) => {
    setEngineId(v)
    setRetryMode("none")
    setRetryConfig({})
  }

  const createMutation = useMutation({
    mutationFn: (data) => profilesApi.create(data),
    onSuccess: () => { onClose(); toast.success("Profile created") },
    onError: (err: Error) => toast.error(`Failed to create profile: ${err.message}`),
  })

  return (
    <CreatePanel
      title="New Profile"
      onClose={onClose}
      submitLabel="Create Profile"
      onSubmit={() => createMutation.mutate({
        name, default_engine_id: parseInt(engineId), resolver_id: parseInt(resolverId),
        retry_mode: retryMode, resolver_config: resolverConfig, retry_config: retryConfig,
      })}
      isPending={createMutation.isPending}
      canSubmit={!!name && !!engineId && !!resolverId}
    >
      <FormField label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-xs" placeholder="My Profile" />
      </FormField>
      <div className="grid grid-cols-2 gap-3 items-end">
        <div className="grid grid-cols-2 gap-2">
          <FormField label="Engine">
            <Select value={engineId} onValueChange={handleEngineChange}>
              <SelectTrigger className="h-8 text-xs w-full"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>{engines.map((e) => <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>)}</SelectContent>
            </Select>
          </FormField>
          <FormField label="Retry Mode">
            <Select value={retryMode} onValueChange={handleRetryModeChange} disabled={!engineId}>
              <SelectTrigger className="h-8 text-xs w-full"><SelectValue placeholder={engineId ? "Select" : "—"} /></SelectTrigger>
              <SelectContent>{availableRetryModes.map((m: string) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </FormField>
        </div>
        <FormField label="Resolver">
          <Select value={resolverId} onValueChange={(v) => { setResolverId(v); setResolverConfig({}) }}>
            <SelectTrigger className="h-8 text-xs w-full"><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>{resolvers.map((r) => <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>)}</SelectContent>
          </Select>
        </FormField>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {retryModeSchema && (
          <div className="rounded-lg border bg-muted/10 p-3 space-y-3">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">Retry Config</p>
            <DynamicForm schema={retryModeSchema} value={retryConfig} onChange={setRetryConfig} />
          </div>
        )}
        {resolverConfigSchema && (
          <div className="rounded-lg border bg-muted/10 p-3 space-y-3">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">Resolver Config</p>
            <DynamicForm schema={resolverConfigSchema} value={resolverConfig} onChange={setResolverConfig} />
          </div>
        )}
      </div>
    </CreatePanel>
  )
}
