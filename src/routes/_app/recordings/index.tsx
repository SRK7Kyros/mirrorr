import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { recordingsApi } from "@/lib/api";
import type { Recording } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { Trash2, Film, Clock, HardDrive, Loader2 } from "lucide-react";
import { InfoGrid } from "@/components/info-grid";
import {
    SidebarLayout,
    SidebarEntry,
    DetailHeader,
    DetailLayout,
    EmptyDetail,
    BulkActionBar,
    SidebarGroupContainer,
} from "@/components/resource-layout";
import { ResizableSidebar } from "@/components/resizable-sidebar";
import { MultiSelectProvider } from "@/hooks/use-multi-select";
import { useBulkDelete } from "@/hooks/use-bulk-delete";
import { useRecordings } from "@/hooks/use-queries";

import { formatDuration, formatBytes, formatLocalDate } from "@/lib/utils";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/recordings/")({
    component: RecordingsPage,
});

function RecordingsPage() {
    const [selectedId, setSelectedId] = useState<number | null>(null);

    const { data: recordings = [], isLoading } = useRecordings();

    const deleteMutation = useMutation({
        mutationFn: (id: number) => recordingsApi.delete(id),
        onSuccess: () => {
            toast.success("Recording deleted");
        },
        onError: (err: Error) =>
            toast.error(`Failed to delete recording: ${err.message}`),
    });

    const recordingIds = recordings.map((r) => r.id);

    return (
        <ResizableSidebar>
            <MultiSelectProvider allIds={recordingIds}>
                <SidebarLayout
                    title="Recordings"
                    count={recordings.length}
                    countLabel="recordings"
                    isLoading={isLoading}
                    emptyText="No recordings"
                    className="bg-card border rounded-xl h-full"
                >
                    <SidebarGroupContainer>
                        {recordings.map((rec) => (
                            <SidebarEntry
                                key={rec.id}
                                id={rec.id}
                                onClick={() => setSelectedId(rec.id)}
                            >
                                <div className="flex items-center gap-2 w-full">
                                    <div className="text-[13px] font-medium truncate">
                                        {rec.user_friendly_name}
                                    </div>
                                    <InlineDeleteButton
                                        id={rec.id}
                                        deleteMutation={deleteMutation}
                                        selectedId={selectedId}
                                        setSelectedId={setSelectedId}
                                    />
                                </div>
                                <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground/60">
                                    <span className="flex items-center gap-0.5">
                                        <Clock className="size-3" />
                                        {formatDuration(rec.duration_seconds)}
                                    </span>
                                    <span className="flex items-center gap-0.5">
                                        <HardDrive className="size-3" />
                                        {formatBytes(rec.size_bytes)}
                                    </span>
                                </div>
                            </SidebarEntry>
                        ))}
                    </SidebarGroupContainer>
                </SidebarLayout>
                <BulkActionBar actions={<BulkDelete />} />
            </MultiSelectProvider>
            {selectedId ? (
                <RecordingDetail
                    recording={recordings.find((r) => r.id === selectedId)}
                    onBack={() => setSelectedId(null)}
                    onDelete={() => {
                        deleteMutation.mutate(selectedId);
                        setSelectedId(null);
                    }}
                    deleting={deleteMutation.isPending}
                />
            ) : (
                <EmptyDetail icon={Film} text="Select a recording" />
            )}
        </ResizableSidebar>
    );
}

/** Per-row delete button — always visible, part of normal sidebar behaviour */
function InlineDeleteButton({
    id,
    deleteMutation,
    selectedId,
    setSelectedId,
}: {
    id: number;
    deleteMutation: any;
    selectedId: number | null;
    setSelectedId: (id: null) => void;
}) {
    return (
        <Button
            variant="ghost"
            size="icon-xs"
            className="ml-auto shrink-0 opacity-0 group-hover:opacity-100 hover:text-destructive"
            onClick={(e) => {
                e.stopPropagation();
                deleteMutation.mutate(id);
                if (selectedId === id) setSelectedId(null);
            }}
            disabled={
                deleteMutation.isPending && deleteMutation.variables === id
            }
        >
            {deleteMutation.isPending && deleteMutation.variables === id ? (
                <Loader2 className="size-3 animate-spin" />
            ) : (
                <Trash2 className="size-3" />
            )}
        </Button>
    );
}

/** Bulk delete button for the floating action bar */
function BulkDelete() {
    const { mutate, isPending } = useBulkDelete(
        recordingsApi.delete,
        "Recordings",
    );
    return (
        <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] text-destructive hover:text-destructive"
            onClick={mutate}
            disabled={isPending}
        >
            {isPending ? (
                <Loader2 className="size-3 mr-1 animate-spin" />
            ) : (
                <Trash2 className="size-3 mr-1" />
            )}
            Bulk Delete
        </Button>
    );
}

function RecordingDetail({
    recording,
    onBack,
    onDelete,
    deleting,
}: {
    recording: Recording | undefined;
    onBack: () => void;
    onDelete: () => void;
    deleting: boolean;
}) {
    if (!recording) return null;
    return (
        <DetailLayout
            header={
                <DetailHeader
                    onBack={onBack}
                    title={recording.user_friendly_name}
                    actions={
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-[11px] text-destructive"
                            onClick={onDelete}
                            disabled={deleting}
                        >
                            {deleting ? (
                                <Loader2 className="size-3 mr-1 animate-spin" />
                            ) : (
                                <Trash2 className="size-3 mr-1" />
                            )}
                            Delete
                        </Button>
                    }
                />
            }
        >
            <InfoGrid
                fields={[
                    { label: "Name", value: recording.user_friendly_name },
                    {
                        label: "Duration",
                        value: formatDuration(recording.duration_seconds),
                    },
                    { label: "Size", value: formatBytes(recording.size_bytes) },
                    {
                        label: "Created",
                        value: formatLocalDate(recording.created_at),
                    },
                ]}
            />
        </DetailLayout>
    );
}
