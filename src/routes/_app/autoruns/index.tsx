import { createFileRoute } from "@tanstack/react-router"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { autorunsApi, profilesApi, pluginsApi, importExportApi } from "@/lib/api"
import { downloadJson } from "@/components/import-dialog"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/status-badge"
import { InfoGrid, StatusField } from "@/components/info-grid"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DateTimePicker } from "@/components/datetime-picker"
import { TimeInput as RelativeTimeInput } from "@/components/masked-input"
import { EtaDisplay } from "@/components/eta-display"
import { Plus, Trash2, CalendarClock, Loader2, Upload, Download, Clock, ArrowRight } from "lucide-react"
import { cn, formatLocalDate, parseUtcDate } from "@/lib/utils"
import { useState, useMemo, useEffect, useRef } from "react"
import { toast } from "sonner"
import { ImportDialog } from "@/components/import-dialog"

export const Route = createFileRoute("/_app/autoruns/")({
  component: AutorunsPage,
})

function AutorunsPage() {
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importBundle, setImportBundle] = useState<Record<string, unknown> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: autoruns = [], isLoading } = useQuery({
    queryKey: ["autoruns"],
    queryFn: () => autorunsApi.list() as Promise<any[]>,
  })

  const { data: profiles = [] } = useQuery({ queryKey: ["profiles"], queryFn: () => profilesApi.list() as Promise<any[]> })
  const { data: engines = [] } = useQuery({ queryKey: ["engines"], queryFn: () => pluginsApi.engines() as Promise<any[]> })

  const profileMap = useMemo(() => Object.fromEntries(profiles.map((p: any) => [p.id, p.name])), [profiles])
  const engineMap = useMemo(() => Object.fromEntries(engines.map((e: any) => [e.id, e.name])), [engines])

  const deleteMutation = useMutation({
    mutationFn: (id: number) => autorunsApi.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["autoruns"] }); toast.success("Autorun deleted") },
    onError: (err: Error) => toast.error(`Failed to delete autorun: ${err.message}`),
  })

  return (
    <div className="h-full grid grid-cols-[300px_1fr] gap-2 p-2">
      {/* Sidebar */}
      <div className="flex flex-col min-h-0 bg-card border rounded-xl overflow-hidden">
        <div className="shrink-0 px-3.5 pt-4 pb-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold tracking-tight">Autoruns</h1>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">{autoruns.length} scheduled</p>
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
            ) : autoruns.length === 0 ? (
              <div className="text-[11px] text-muted-foreground text-center py-6">No autoruns</div>
            ) : (
              autoruns.map((a: any) => (
                <div key={a.id} className={cn("relative px-2.5 py-2.5 rounded-md transition-colors group cursor-pointer", selectedId === a.id ? "bg-muted/60" : "hover:bg-muted/40")} onClick={() => { setSelectedId(a.id); setShowCreate(false) }}>
                  <div className="absolute top-2 right-2"><StatusBadge status={a.status ?? "scheduled"} /></div>
                  <div className="text-[13px] font-medium truncate pr-20">{a.user_friendly_name}</div>
                  <div className="flex items-center gap-1.5 mt-1 text-[10px] text-muted-foreground/60">
                    <Clock className="size-3" />
                    <span>{formatLocalDate(a.start_time, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</span>
                    <ArrowRight className="size-3" />
                    <span>{formatLocalDate(a.end_time, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</span>
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
          <CreateAutorunPanel onClose={() => setShowCreate(false)} />
        ) : selectedId ? (
          <AutorunDetail autorun={autoruns.find((a: any) => a.id === selectedId)} onBack={() => setSelectedId(null)}
            onDelete={() => { deleteMutation.mutate(selectedId); setSelectedId(null) }}
            deleting={deleteMutation.isPending}
            profileMap={profileMap} engineMap={engineMap}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <CalendarClock className="size-8 mb-2 opacity-15" />
            <p className="text-xs">Select an autorun</p>
          </div>
        )}
      </div>
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImported={() => queryClient.invalidateQueries({ queryKey: ["autoruns"] })} bundle={importBundle} />
    </div>
  )
}

function AutorunDetail({ autorun, onBack, onDelete, deleting, profileMap, engineMap }: { autorun: any; onBack: () => void; onDelete: () => void; deleting: boolean; profileMap: Record<number, string>; engineMap: Record<number, string> }) {
  const [exporting, setExporting] = useState(false)
  const { data: resolvers = [] } = useQuery({ queryKey: ["resolvers"], queryFn: () => pluginsApi.resolvers() as Promise<any[]> })
  const { data: profiles = [] } = useQuery({ queryKey: ["profiles"], queryFn: () => profilesApi.list() as Promise<any[]> })

  const profile = profiles.find((p: any) => p.id === autorun?.profile_id)
  const resolver = resolvers.find((r: any) => r.id === profile?.resolver_id)

  async function handleExport() {
    if (!autorun) return
    setExporting(true)
    try {
      const bundle = await importExportApi.exportAutorun(autorun.id)
      downloadJson(`${autorun.user_friendly_name.replace(/\s+/g, "_")}.json`, bundle)
      toast.success("Autorun exported")
    } catch (err: any) {
      toast.error(`Export failed: ${err.message}`)
    } finally {
      setExporting(false)
    }
  }

  if (!autorun) return null
  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-5 pt-5 pb-3 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={onBack}>← Back</Button>
            <h2 className="text-sm font-bold">{autorun.user_friendly_name}</h2>
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
        {/* Detail grid */}
        <InfoGrid columns={5} fields={[
          { label: "Status", value: <StatusField status={autorun.status ?? "scheduled"} /> },
          { label: "Name", value: autorun.user_friendly_name },
          { label: "Profile", value: profileMap[autorun.profile_id] ?? `#${autorun.profile_id}` },
          { label: "Engine", value: engineMap[autorun.engine_id] ?? `#${autorun.engine_id}` },
          { label: "Resolver", value: resolver?.name ?? `#${profile?.resolver_id ?? "?"}` },
        ]} />
        {/* Row 2: Start Time, End Time */}
        <div className="flex gap-4">
          {autorun.start_time && <div className="space-y-1 shrink-0"><Label className="text-[11px] text-muted-foreground">Start Time</Label><p className="text-xs">{formatLocalDate(autorun.start_time)}</p></div>}
          {autorun.end_time && <div className="space-y-1 shrink-0"><Label className="text-[11px] text-muted-foreground">End Time</Label><p className="text-xs">{formatLocalDate(autorun.end_time)}</p></div>}
        </div>
      </div>
    </div>
  )
}

function CreateAutorunPanel({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState("")
  const [profileName, setProfileName] = useState("")
  const [engineName, setEngineName] = useState("")
  const [timeMode, setTimeMode] = useState<"pick" | "relative">("pick")
  const [startTime, setStartTime] = useState("")
  const [endTime, setEndTime] = useState("")
  const [relativeStartOffset, setRelativeStartOffset] = useState<number>(0)
  const [relativeEndOffset, setRelativeEndOffset] = useState<number>(0)
  const [now, setNow] = useState(() => Date.now())

  // Auto-tick every second so relative epochs stay current
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const { data: profiles = [] } = useQuery({ queryKey: ["profiles"], queryFn: () => profilesApi.list() as Promise<any[]> })
  const { data: engines = [] } = useQuery({ queryKey: ["engines"], queryFn: () => pluginsApi.engines() as Promise<any[]> })

  const createMutation = useMutation({
    mutationFn: (data: any) => autorunsApi.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["autoruns"] }); onClose(); toast.success("Autorun created") },
    onError: (err: Error) => toast.error(`Failed to create autorun: ${err.message}`),
  })

  const selectedProfile: any = profiles.find((p: any) => p.name === profileName)
  const selectedProfileId = selectedProfile?.id
  const selectedEngineId = engines.find((e: any) => e.name === engineName)?.id ?? selectedProfile?.default_engine_id

  const getStartTime = () => timeMode === "relative" ? new Date(now + relativeStartOffset).toISOString() : startTime
  const getEndTime = () => timeMode === "relative" ? new Date(now + relativeEndOffset).toISOString() : endTime

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-5 pt-5 pb-3 border-b">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">New Autorun</h2>
          <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={onClose}>Cancel</Button>
        </div>
      </div>
      <div className="relative flex-1 min-h-0">
        <div className="absolute inset-x-0 bottom-0 z-10 px-5 py-3 flex justify-center">
          <Button size="sm" className="h-8 text-[11px] px-6 shadow-lg" onClick={() => {
            createMutation.mutate({
              user_friendly_name: name, snake_case_name: name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""),
              profile_id: selectedProfileId, engine_id: selectedEngineId,
              start_time: getStartTime(), end_time: getEndTime(), recording: true,
            })
          }} disabled={!name || !profileName || createMutation.isPending}>
            {createMutation.isPending && <Loader2 className="mr-1 size-3 animate-spin" />}
            Create Autorun
          </Button>
        </div>
        <div className="h-full overflow-y-auto px-5 py-4 pb-14 space-y-3">
          <div className="space-y-1.5">
            <Label className="text-[11px]">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-xs" placeholder="My Stream" />
          </div>
          <div className="grid grid-cols-2 grid-rows-1 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[11px]">Profile</Label>
              <Select value={profileName} onValueChange={setProfileName} items={profiles.map((p: any) => ({ value: p.name, label: p.name }))}>
                <SelectTrigger className="h-8 text-xs w-full"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{profiles.map((p: any) => <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px]">Engine</Label>
              <Select value={engineName} onValueChange={setEngineName} items={engines.map((e: any) => ({ value: e.name, label: e.name }))}>
                <SelectTrigger className="h-8 text-xs w-full"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{engines.map((e: any) => <SelectItem key={e.id} value={e.name}>{e.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <Label className="text-[11px] font-medium">Schedule</Label>
            <Tabs value={timeMode} onValueChange={(v) => setTimeMode(v as any)}>
              <TabsList className="h-7">
                <TabsTrigger value="pick" className="text-[11px] h-6">Pick Date & Time</TabsTrigger>
                <TabsTrigger value="relative" className="text-[11px] h-6">Relative Duration</TabsTrigger>
              </TabsList>
              <TabsContent value="pick" className="space-y-3 mt-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5"><Label className="text-[11px]">Start</Label><DateTimePicker value={startTime} onChange={setStartTime} />{startTime && <EtaDisplay value={startTime} mode="relative" className="text-[10px] text-muted-foreground/70 italic" />}</div>
                  <div className="space-y-1.5"><Label className="text-[11px]">End</Label><DateTimePicker value={endTime} onChange={setEndTime} />{endTime && <EtaDisplay value={endTime} mode="relative" className="text-[10px] text-muted-foreground/70 italic" />}</div>
                </div>
              </TabsContent>
              <TabsContent value="relative" className="space-y-3 mt-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5"><Label className="text-[11px]">Start (relative)</Label><RelativeTimeInput format="MM-DD-HH:mm:ss" value={null} onChange={setRelativeStartOffset} />{relativeStartOffset > 0 && <EtaDisplay value={new Date(now + relativeStartOffset).toISOString()} mode="relative" className="text-[10px] text-muted-foreground/70 italic" />}</div>
                  <div className="space-y-1.5"><Label className="text-[11px]">End (relative)</Label><RelativeTimeInput format="MM-DD-HH:mm:ss" value={null} onChange={setRelativeEndOffset} />{relativeEndOffset > 0 && <EtaDisplay value={new Date(now + relativeEndOffset).toISOString()} mode="relative" className="text-[10px] text-muted-foreground/70 italic" />}</div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </div>
  )
}
