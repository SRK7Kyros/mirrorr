import { createFileRoute } from "@tanstack/react-router"
import { useQuery, useMutation } from "@tanstack/react-query"
import { recordingsApi } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Card } from "@/components/ui/card"
import { Trash2, Film, Clock, HardDrive, Play, Loader2 } from "lucide-react"
import { Label } from "@/components/ui/label"
import { InfoGrid } from "@/components/info-grid"
import { formatLocalDate } from "@/lib/utils"
import { formatDuration, formatBytes, cn } from "@/lib/utils"
import { useState } from "react"
import { toast } from "sonner"

export const Route = createFileRoute("/_app/recordings/")({
  component: RecordingsPage,
})

function RecordingsPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const { data: recordings = [], isLoading } = useQuery({
    queryKey: ["recordings"],
    queryFn: () => recordingsApi.list() as Promise<any[]>,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => recordingsApi.delete(id),
    onSuccess: () => { toast.success("Recording deleted") },
    onError: (err: Error) => toast.error(`Failed to delete recording: ${err.message}`),
  })

  return (
    <div className="h-full grid grid-cols-[300px_1fr] gap-2 p-2">
      {/* Sidebar */}
      <div className="flex flex-col min-h-0 bg-card border rounded-xl overflow-hidden">
        <div className="shrink-0 px-3.5 pt-4 pb-3">
          <h1 className="text-lg font-bold tracking-tight">Recordings</h1>
          <p className="text-[11px] text-muted-foreground/60 mt-0.5">{recordings.length} recordings</p>
        </div>
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-1.5 space-y-px">
            {isLoading ? (
              <div className="text-[11px] text-muted-foreground text-center py-6">Loading...</div>
            ) : recordings.length === 0 ? (
              <div className="text-[11px] text-muted-foreground text-center py-6">No recordings</div>
            ) : (
              recordings.map((rec: any) => (
                <RecordingEntry key={rec.id} rec={rec} selected={selectedId === rec.id} onSelect={() => setSelectedId(rec.id)} onDelete={() => { deleteMutation.mutate(rec.id); if (selectedId === rec.id) setSelectedId(null) }} deleting={deleteMutation.isPending && deleteMutation.variables === rec.id} />
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Detail */}
      <div className="min-h-0 overflow-auto bg-card border rounded-xl">
        {selectedId ? (
          <RecordingDetail recording={recordings.find((r: any) => r.id === selectedId)} onBack={() => setSelectedId(null)}
            onDelete={() => { deleteMutation.mutate(selectedId); setSelectedId(null) }}
            deleting={deleteMutation.isPending}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Film className="size-8 mb-2 opacity-15" />
            <p className="text-xs">Select a recording</p>
          </div>
        )}
      </div>
    </div>
  )
}

function RecordingEntry({ rec, selected, onSelect, onDelete, deleting }: { rec: any; selected: boolean; onSelect: () => void; onDelete: () => void; deleting: boolean }) {
  return (
    <div className={cn("px-2.5 py-2.5 rounded-md transition-colors group cursor-pointer", selected ? "bg-muted/60" : "hover:bg-muted/40")} onClick={onSelect}>
      <div className="flex items-center gap-2">
        <div className="text-[13px] font-medium truncate">{rec.user_friendly_name}</div>
        <Button variant="ghost" size="icon-xs" className="ml-auto shrink-0 opacity-0 group-hover:opacity-100 hover:text-destructive" onClick={(e) => { e.stopPropagation(); onDelete() }} disabled={deleting}>
          {deleting ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
        </Button>
      </div>
      <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground/60">
        <span className="flex items-center gap-0.5"><Clock className="size-3" />{formatDuration(rec.duration_seconds)}</span>
        <span className="flex items-center gap-0.5"><HardDrive className="size-3" />{formatBytes(rec.size_bytes)}</span>
      </div>
    </div>
  )
}

function RecordingDetail({ recording, onBack, onDelete, deleting }: { recording: any; onBack: () => void; onDelete: () => void; deleting: boolean }) {
  if (!recording) return null
  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-5 pt-5 pb-3 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={onBack}>← Back</Button>
            <h2 className="text-sm font-bold">{recording.user_friendly_name}</h2>
          </div>
          <Button variant="ghost" size="sm" className="h-7 text-[11px] text-destructive" onClick={onDelete} disabled={deleting}>{deleting ? <Loader2 className="size-3 mr-1 animate-spin" /> : <Trash2 className="size-3 mr-1" />}Delete</Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        <InfoGrid columns={4} fields={[
          { label: "Name", value: recording.user_friendly_name },
          { label: "Duration", value: formatDuration(recording.duration_seconds) },
          { label: "Size", value: formatBytes(recording.size_bytes) },
          { label: "Created", value: formatLocalDate(recording.created_at) },
        ]} />
      </div>
    </div>
  )
}
