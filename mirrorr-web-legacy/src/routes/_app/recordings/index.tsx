import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { recordingsApi } from "@/lib/api";
import type { Recording } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Trash2, Film, Clock, HardDrive, Loader2 } from "lucide-react";
import { InfoGrid } from "@/components/info-grid";
import { DeleteConfirm } from "@/components/delete-confirm";
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
import { BulkDeleteButton } from "@/components/bulk-delete-button";
import { MultiSelectProvider } from "@/hooks/use-multi-select";
import { useRecordings } from "@/hooks/use-queries";

import { formatDuration, formatBytes, formatLocalDate, describeCascade } from "@/lib/utils";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/recordings/")({
	component: RecordingsPage,
});

function RecordingsPage() {
	const queryClient = useQueryClient();
	const [selectedId, setSelectedId] = useState<number | null>(null);

	const { data: recordings = [], isLoading } = useRecordings();

	const deleteMutation = useMutation({
		mutationFn: (id: number) => recordingsApi.delete(id),
		onSuccess: (res) => {
			queryClient.invalidateQueries({ queryKey: ["recordings"] });
			const cascade = describeCascade(res);
			toast.success(
				cascade ? `Recording deleted — also removed ${cascade}` : "Recording deleted",
			);
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
									<DeleteConfirm
										entityName="Recording"
										isPending={
											deleteMutation.isPending &&
											deleteMutation.variables === rec.id
										}
										onConfirm={() => {
											deleteMutation.mutate(rec.id);
											if (selectedId === rec.id) setSelectedId(null);
										}}
									/>
								</div>
								<div className="flex items-center gap-2 mt-1 text-micro text-muted-foreground/60">
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
				<BulkActionBar
					actions={
						<BulkDeleteButton
							deleteFn={recordingsApi.delete}
							entityLabel="recording"
							entityLabelPlural="Recordings"
						/>
					}
				/>
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
						<DeleteConfirm
							entityName="Recording"
							isPending={deleting}
							onConfirm={onDelete}
						>
							<Button
								variant="ghost"
								size="sm"
								className="h-7 text-xs text-destructive"
								disabled={deleting}
							>
								{deleting ? (
									<Loader2 className="size-3 mr-1 animate-spin" />
								) : (
									<Trash2 className="size-3 mr-1" />
								)}
								Delete
							</Button>
						</DeleteConfirm>
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
					{
						label: "Engine",
						value: recording.engine_name || "—",
					},
					{
						label: "Resolver",
						value: recording.resolver_name || "—",
					},
					{
						label: "Session",
						value: recording.session_id != null ? `#${recording.session_id}` : "—",
					},
				]}
			/>
			<div className="space-y-1">
				<Label className="text-xs text-muted-foreground">Media</Label>
				{recording.media_served ? (
					<a
						href={recording.content_url}
						target="_blank"
						rel="noreferrer"
						className="text-xs text-primary underline-offset-2 hover:underline"
					>
						Open recording ↗
					</a>
				) : (
					<p className="text-xs text-muted-foreground/70">
						Media is not served on this install — download/open link
						unavailable.
					</p>
				)}
			</div>
		</DetailLayout>
	);
}
