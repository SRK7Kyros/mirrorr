import { createFileRoute } from "@tanstack/react-router"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { autorunsApi, profilesApi, pluginsApi, importExportApi } from "@/lib/api"
import type { Autorun } from "@/lib/schemas"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/status-badge"
import { InfoGrid } from "@/components/info-grid"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DateTimePicker } from "@/components/datetime-picker"
import { TimeInput as RelativeTimeInput } from "@/components/masked-input"
import { EtaDisplay } from "@/components/eta-display"
import { Trash2, CalendarClock, Loader2, ArrowRight } from "lucide-react"
import { formatLocalDate } from "@/lib/utils"
import { useState, useMemo, useEffect } from "react"
import { useInterval } from "@/hooks/use-interval"
import { toast } from "sonner"
import { ImportDialog } from "@/components/import-dialog"
import { ImportButton, ExportButton } from "@/components/import-export-buttons"
import { FormField } from "@/components/form-field"
import { SidebarLayout, SidebarEntry, DetailHeader, DetailLayout, CreatePanel, EmptyDetail } from "@/components/resource-layout"
import { ResizableSidebar } from "@/components/resizable-sidebar"


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

  return (
    <ResizableSidebar>
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
        {autoruns.map((a) => (
          <SidebarEntry
            key={a.id}
            selected={selectedId === a.id}
            onClick={() => { setSelectedId(a.id); setShowCreate(false) }}
            className="relative"
          >
            <div className="absolute top-2 right-2"><StatusBadge status={a.status ?? "scheduled"} /></div>
            <div className="text-[13px] font-medium truncate pr-20">{a.user_friendly_name}</div>
            <div className="flex items-center gap-1.5 mt-1 text-[10px] text-muted-foreground/60">
              <span>{formatLocalDate(a.start_time, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</span>
              <ArrowRight className="size-3" />
              <span>{formatLocalDate(a.end_time, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</span>
            </div>
          </SidebarEntry>
        ))}
      </SidebarLayout>
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

function AutorunDetail({ autorun, onBack, onDelete, deleting, profileMap, engineMap }: { autorun: Autorun | undefined; onBack: () => void; onDelete: () => void; deleting: boolean; profileMap: Record<number, string>; engineMap: Record<number, string> }) {
  const { data: resolvers = [] } = useQuery({ queryKey: ["resolvers"], queryFn: () => pluginsApi.resolvers() as Promise<any[]> })
  const { data: profiles = [] } = useQuery({ queryKey: ["profiles"], queryFn: () => profilesApi.list() as Promise<any[]> })

  const profile = profiles.find((p) => p.id === autorun?.profile_id)
  const resolver = resolvers.find((r) => r.id === profile?.resolver_id)

  if (!autorun) return null
  return (
    <DetailLayout
      header={
        <DetailHeader
          onBack={onBack}
          title={autorun.user_friendly_name}
          actions={
            <div className="flex items-center gap-1">
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
        { label: "Resolver", value: resolver?.name ?? `#${profile?.resolver_id ?? "?"}` },
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
  const [profileName, setProfileName] = useState("")
  const [engineName, setEngineName] = useState("")
  const [timeMode, setTimeMode] = useState<"pick" | "relative">("pick")
  const [startTime, setStartTime] = useState("")
  const [endTime, setEndTime] = useState("")
  const [relativeStartOffset, setRelativeStartOffset] = useState<number>(0)
  const [relativeEndOffset, setRelativeEndOffset] = useState<number>(0)
  const [now, setNow] = useState(() => Date.now())

  // Auto-tick every second so relative epochs stay current
  useInterval(() => setNow(Date.now()), 1000)

  const { data: profiles = [] } = useQuery({ queryKey: ["profiles"], queryFn: () => profilesApi.list() as Promise<any[]> })
  const { data: engines = [] } = useQuery({ queryKey: ["engines"], queryFn: () => pluginsApi.engines() as Promise<any[]> })

  const createMutation = useMutation({
    mutationFn: (data) => autorunsApi.create(data),
    onSuccess: () => { onClose(); toast.success("Autorun created") },
    onError: (err: Error) => toast.error(`Failed to create autorun: ${err.message}`),
  })

  const selectedProfile = profiles.find((p) => p.name === profileName)
  const selectedProfileId = selectedProfile?.id
  const selectedEngineId = engines.find((e) => e.name === engineName)?.id ?? selectedProfile?.default_engine_id

  const getStartTime = () => timeMode === "relative" ? new Date(now + relativeStartOffset).toISOString() : startTime
  const getEndTime = () => timeMode === "relative" ? new Date(now + relativeEndOffset).toISOString() : endTime

  return (
    <CreatePanel
      title="New Autorun"
      onClose={onClose}
      submitLabel="Create Autorun"
      onSubmit={() => {
        createMutation.mutate({
          user_friendly_name: name, snake_case_name: name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""),
          profile_id: selectedProfileId, engine_id: selectedEngineId,
          start_time: getStartTime(), end_time: getEndTime(), recording: true,
        })
      }}
      isPending={createMutation.isPending}
      canSubmit={!!name && !!profileName}
    >
      <FormField label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-xs" placeholder="My Stream" />
      </FormField>
      <div className="grid grid-cols-2 grid-rows-1 gap-3">
        <FormField label="Profile">
          <Select value={profileName} onValueChange={setProfileName} items={profiles.map((p) => ({ value: p.name, label: p.name }))}>
            <SelectTrigger className="h-8 text-xs w-full"><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>{profiles.map((p) => <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
        </FormField>
        <FormField label="Engine">
          <Select value={engineName} onValueChange={setEngineName} items={engines.map((e) => ({ value: e.name, label: e.name }))}>
            <SelectTrigger className="h-8 text-xs w-full"><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>{engines.map((e) => <SelectItem key={e.id} value={e.name}>{e.name}</SelectItem>)}</SelectContent>
          </Select>
        </FormField>
      </div>
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
