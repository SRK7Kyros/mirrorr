import { createFileRoute } from "@tanstack/react-router"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { profilesApi, pluginsApi, importExportApi } from "@/lib/api"
import { KeyValueTable } from "@/components/key-value-table"
import { downloadJson } from "@/components/import-dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DynamicForm } from "@/components/dynamic-form"
import { CopyButton } from "@/components/schema-viewer"
import { Plus, Trash2, Settings, Cpu, Zap, Loader2, Braces, Upload, Download } from "lucide-react"
import { cn } from "@/lib/utils"
import { useState, useMemo, useRef } from "react"
import { toast } from "sonner"
import { ImportDialog } from "@/components/import-dialog"
import { InfoGrid } from "@/components/info-grid"

export const Route = createFileRoute("/_app/profiles/")({
  component: ProfilesPage,
})

function ProfilesPage() {
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importBundle, setImportBundle] = useState<Record<string, unknown> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ["profiles"],
    queryFn: () => profilesApi.list() as Promise<any[]>,
  })

  const { data: engines = [] } = useQuery({
    queryKey: ["engines"],
    queryFn: () => pluginsApi.engines() as Promise<any[]>,
  })

  const { data: resolvers = [] } = useQuery({
    queryKey: ["resolvers"],
    queryFn: () => pluginsApi.resolvers() as Promise<any[]>,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => profilesApi.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["profiles"] }); toast.success("Profile deleted") },
    onError: (err: Error) => toast.error(`Failed to delete profile: ${err.message}`),
  })

  return (
    <div className="h-full grid grid-cols-[300px_1fr] gap-2 p-2">
      {/* Sidebar */}
      <div className="flex flex-col min-h-0 bg-card border rounded-xl overflow-hidden">
        <div className="shrink-0 px-3.5 pt-4 pb-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold tracking-tight">Profiles</h1>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">{profiles.length} profiles</p>
          </div>
          <div className="flex items-center gap-1">
            <input ref={fileInputRef} type="file" accept=".json" multiple className="hidden" onChange={(e) => {
              const files = e.target.files
              if (!files?.length) return
              const file = files[0]
              file.text().then((text) => {
                try {
                  const bundle = JSON.parse(text)
                  setImportBundle(bundle)
                  setImportOpen(true)
                } catch { toast.error("Invalid JSON file") }
              })
              e.target.value = ""
            }} />
            <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => fileInputRef.current?.click()}>
              <Upload className="size-3 mr-1" />Import
            </Button>
            <Button size="sm" className="h-7 text-[11px]" onClick={() => setShowCreate(true)}>
              <Plus className="size-3 mr-1" />New
            </Button>
          </div>
        </div>
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-1.5 space-y-px">
            {isLoading ? (
              <div className="text-[11px] text-muted-foreground text-center py-6">Loading...</div>
            ) : profiles.length === 0 ? (
              <div className="text-[11px] text-muted-foreground text-center py-6">No profiles</div>
            ) : (
              profiles.map((p: any) => (
                <div key={p.id} className={cn("px-2.5 py-2.5 rounded-md transition-colors group cursor-pointer", selectedId === p.id ? "bg-muted/60" : "hover:bg-muted/40")} onClick={() => { setSelectedId(p.id); setShowCreate(false) }}>
                  <div className="flex items-center gap-2">
                    <div className="text-[13px] font-medium truncate">{p.name}</div>
                    <Button variant="ghost" size="icon-xs" className="ml-auto shrink-0 opacity-0 group-hover:opacity-100 hover:text-destructive" onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(p.id) }} disabled={deleteMutation.isPending && deleteMutation.variables === p.id}>
                      {deleteMutation.isPending && deleteMutation.variables === p.id ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground/60">
                    <span className="flex items-center gap-0.5"><Cpu className="size-3" />{engines.find((e: any) => e.id === p.default_engine_id)?.name ?? `Engine #${p.default_engine_id}`}</span>
                    <span className="flex items-center gap-0.5"><Zap className="size-3" />{resolvers.find((r: any) => r.id === p.resolver_id)?.name ?? `Resolver #${p.resolver_id}`}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Detail / Create panel */}
      <div className="min-h-0 overflow-auto bg-card border rounded-xl">
        {showCreate ? (
          <CreateProfilePanel onClose={() => setShowCreate(false)} />
        ) : selectedId ? (
          <ProfileDetail profile={profiles.find((p: any) => p.id === selectedId)} onBack={() => setSelectedId(null)}
            onDelete={() => { deleteMutation.mutate(selectedId); setSelectedId(null) }}
            deleting={deleteMutation.isPending}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Settings className="size-8 mb-2 opacity-15" />
            <p className="text-xs">Select a profile</p>
          </div>
        )}
      </div>
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImported={() => queryClient.invalidateQueries({ queryKey: ["profiles"] })} bundle={importBundle} />
    </div>
  )
}

function ProfileDetail({ profile, onBack, onDelete, deleting }: { profile: any; onBack: () => void; onDelete: () => void; deleting: boolean }) {
  const { data: engines = [] } = useQuery({ queryKey: ["engines"], queryFn: () => pluginsApi.engines() as Promise<any[]> })
  const { data: resolvers = [] } = useQuery({ queryKey: ["resolvers"], queryFn: () => pluginsApi.resolvers() as Promise<any[]> })
  const [exporting, setExporting] = useState(false)

  async function handleExport() {
    if (!profile) return
    setExporting(true)
    try {
      const bundle = await importExportApi.exportProfile(profile.id)
      downloadJson(`${profile.name.replace(/\s+/g, "_")}.json`, bundle)
      toast.success("Profile exported")
    } catch (err: any) {
      toast.error(`Export failed: ${err.message}`)
    } finally {
      setExporting(false)
    }
  }

  if (!profile) return null
  const engine = engines.find((e: any) => e.id === profile.default_engine_id)
  const resolver = resolvers.find((r: any) => r.id === profile.resolver_id)
  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-5 pt-5 pb-3 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={onBack}>← Back</Button>
            <h2 className="text-sm font-bold">{profile.name}</h2>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={handleExport} disabled={exporting}>
              {exporting ? <Loader2 className="size-3 mr-1 animate-spin" /> : <Download className="size-3 mr-1" />}Export
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-[11px] text-destructive" onClick={onDelete} disabled={deleting}>{deleting ? <Loader2 className="size-3 mr-1 animate-spin" /> : <Trash2 className="size-3 mr-1" />}Delete</Button>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        <InfoGrid
          columns={2}
          fields={[
            { label: "Name", value: profile.name },
            { label: "Retry Mode", value: profile.retry_mode ?? "none" },
            { label: "Engine", value: engine?.name ?? `#${profile.default_engine_id}` },
            { label: "Resolver", value: resolver?.name ?? `#${profile.resolver_id}` },
          ]}
        />
        <KeyValueTable title="Resolver Config" entries={Object.entries(profile.resolver_config ?? {})} json={profile.resolver_config} emptyText="None" />
        <KeyValueTable title="Retry Config" entries={Object.entries(profile.retry_config ?? {})} json={profile.retry_config} emptyText="None" />
      </div>
    </div>
  )
}

function CreateProfilePanel({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
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
    return engines.find((e: any) => e.id === parseInt(engineId)) ?? null
  }, [engineId, engines])

  const selectedResolver = useMemo(() => {
    if (!resolverId) return null
    return resolvers.find((r: any) => r.id === parseInt(resolverId)) ?? null
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
    mutationFn: (data: any) => profilesApi.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["profiles"] }); onClose(); toast.success("Profile created") },
    onError: (err: Error) => toast.error(`Failed to create profile: ${err.message}`),
  })

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-5 pt-5 pb-3 border-b">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">New Profile</h2>
          <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={onClose}>Cancel</Button>
        </div>
      </div>
      <div className="relative flex-1 min-h-0">
        <div className="absolute inset-x-0 bottom-0 z-10 px-5 py-3 flex justify-center">
          <Button size="sm" className="h-8 text-[11px] px-6 shadow-lg" onClick={() => createMutation.mutate({
            name, default_engine_id: parseInt(engineId), resolver_id: parseInt(resolverId),
            retry_mode: retryMode, resolver_config: resolverConfig, retry_config: retryConfig,
          })} disabled={!name || !engineId || !resolverId || createMutation.isPending}>
            {createMutation.isPending && <Loader2 className="mr-1 size-3 animate-spin" />}
            Create Profile
          </Button>
        </div>
        <div className="h-full overflow-y-auto px-5 py-4 pb-14 space-y-3">
          {/* Name */}
          <div className="space-y-1.5">
            <Label className="text-[11px]">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-xs" placeholder="My Profile" />
          </div>
          {/* Two columns: Engine+RetryMode | Resolver */}
          <div className="grid grid-cols-2 gap-3 items-end">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-[11px]">Engine</Label>
                <Select value={engineId} onValueChange={handleEngineChange}>
                  <SelectTrigger className="h-8 text-xs w-full"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{engines.map((e: any) => <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px]">Retry Mode</Label>
                <Select value={retryMode} onValueChange={handleRetryModeChange} disabled={!engineId}>
                  <SelectTrigger className="h-8 text-xs w-full"><SelectValue placeholder={engineId ? "Select" : "—"} /></SelectTrigger>
                  <SelectContent>{availableRetryModes.map((m: string) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px]">Resolver</Label>
              <Select value={resolverId} onValueChange={(v) => { setResolverId(v); setResolverConfig({}) }}>
                <SelectTrigger className="h-8 text-xs w-full"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{resolvers.map((r: any) => <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          {/* Config panels side by side */}
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
        </div>
      </div>
    </div>
  )
}
