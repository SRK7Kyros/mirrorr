import { createFileRoute } from "@tanstack/react-router"
import { useQuery, useMutation } from "@tanstack/react-query"
import { recordingsApi } from "@/lib/api"
import type { Recording } from "@/lib/schemas"
import { Button } from "@/components/ui/button"
import { Trash2, Film, Clock, HardDrive, Loader2 } from "lucide-react"
import { InfoGrid } from "@/components/info-grid"
import { SidebarLayout, SidebarEntry, DetailHeader, DetailLayout, EmptyDetail } from "@/components/resource-layout"
import { ResizableSidebar } from "@/components/resizable-sidebar"

import { formatDuration, formatBytes, formatLocalDate } from "@/lib/utils"
import { useState } from "react"
import { toast } from "sonner"

export const Route = createFileRoute("/_app/recordings/")({
  component: RecordingsPage,
})

function RecordingsPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const { data: recordings = [], isLoading } = useQuery({
    queryKey: ["recordings"],
    queryFn: () => recordingsApi.list(),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => recordingsApi.delete(id),
    onSuccess: () => { toast.success("Recording deleted") },
    onError: (err: Error) => toast.error(`Failed to delete recording: ${err.message}`),
  })

  return (
    <ResizableSidebar>
      <SidebarLayout
        title="Recordings"
        count={recordings.length}
        countLabel="recordings"
        isLoading={isLoading}
        emptyText="No recordings"
        className="bg-card border rounded-xl h-full"
      >
        {recordings.map((rec) => (
          <SidebarEntry
            key={rec.id}
            selected={selectedId === rec.id}
            onClick={() => setSelectedId(rec.id)}
          >
            <div className="flex items-center gap-2">
              <div className="text-[13px] font-medium truncate">{rec.user_friendly_name}</div>
              <Button
                variant="ghost" size="icon-xs"
                className="ml-auto shrink-0 opacity-0 group-hover:opacity-100 hover:text-destructive"
                onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(rec.id); if (selectedId === rec.id) setSelectedId(null) }}
                disabled={deleteMutation.isPending && deleteMutation.variables === rec.id}
              >
                {deleteMutation.isPending && deleteMutation.variables === rec.id ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
              </Button>
            </div>
            <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground/60">
              <span className="flex items-center gap-0.5"><Clock className="size-3" />{formatDuration(rec.duration_seconds)}</span>
              <span className="flex items-center gap-0.5"><HardDrive className="size-3" />{formatBytes(rec.size_bytes)}</span>
            </div>
          </SidebarEntry>
        ))}
      </SidebarLayout>
      {selectedId ? (
        <RecordingDetail
          recording={recordings.find((r) => r.id === selectedId)}
          onBack={() => setSelectedId(null)}
          onDelete={() => { deleteMutation.mutate(selectedId); setSelectedId(null) }}
          deleting={deleteMutation.isPending}
        />
      ) : (
        <EmptyDetail icon={Film} text="Select a recording" />
      )}
    </ResizableSidebar>
  )
}

function RecordingDetail({ recording, onBack, onDelete, deleting }: { recording: Recording | undefined; onBack: () => void; onDelete: () => void; deleting: boolean }) {
  if (!recording) return null
  return (
    <DetailLayout
      header={
        <DetailHeader
          onBack={onBack}
          title={recording.user_friendly_name}
          actions={
            <Button variant="ghost" size="sm" className="h-7 text-[11px] text-destructive" onClick={onDelete} disabled={deleting}>
              {deleting ? <Loader2 className="size-3 mr-1 animate-spin" /> : <Trash2 className="size-3 mr-1" />}Delete
            </Button>
          }
        />
      }
    >
      <InfoGrid fields={[
        { label: "Name", value: recording.user_friendly_name },
        { label: "Duration", value: formatDuration(recording.duration_seconds) },
        { label: "Size", value: formatBytes(recording.size_bytes) },
        { label: "Created", value: formatLocalDate(recording.created_at) },
      ]} />
    </DetailLayout>
  )
}
