import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { profilesApi, importExportApi } from "@/lib/api";
import type { Profile } from "@/lib/schemas";
import { KeyValueTable } from "@/components/key-value-table";
import { Button } from "@/components/ui/button";
import { DeleteConfirm } from "@/components/delete-confirm";
import { Input } from "@/components/ui/input";
import { Trash2, Settings, Cpu, Zap, Loader2, Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ImportDialog } from "@/components/import-dialog";
import { ImportButton, ExportButton } from "@/components/import-export-buttons";
import { InfoGrid } from "@/components/info-grid";
import { FormField } from "@/components/form-field";
import {
	SidebarLayout,
	SidebarEntry,
	DetailHeader,
	DetailLayout,
	CreatePanel,
	EmptyDetail,
	BulkActionBar,
	SidebarGroupContainer,
} from "@/components/resource-layout";
import { ResizableSidebar } from "@/components/resizable-sidebar";
import { MultiSelectProvider } from "@/hooks/use-multi-select";
import { usePluginConfig } from "@/hooks/use-plugin-config";
import { useBulkDelete } from "@/hooks/use-bulk-delete";
import { PluginConfigFields } from "@/components/config-fields";
import { useProfiles, useEngines, useResolvers } from "@/hooks/use-queries";
import { useBulkExport } from "@/hooks/use-bulk-export";
import { InlineDeleteButton } from "@/components/inline-delete-button";

export const Route = createFileRoute("/_app/profiles/")({
	component: ProfilesPage,
});

function ProfilesPage() {
	const queryClient = useQueryClient();
	const [showCreate, setShowCreate] = useState(false);
	const [selectedId, setSelectedId] = useState<number | null>(null);
	const [importOpen, setImportOpen] = useState(false);
	const [importBundle, setImportBundle] = useState<Record<
		string,
		unknown
	> | null>(null);

	const { data: profiles = [], isLoading } = useProfiles();

	const { data: engines = [] } = useEngines();

	const { data: resolvers = [] } = useResolvers();

	const deleteMutation = useMutation({
		mutationFn: (id: number) => profilesApi.delete(id),
		onSuccess: () => {
			toast.success("Profile deleted");
		},
		onError: (err: Error) =>
			toast.error(`Failed to delete profile: ${err.message}`),
	});

	const profileIds = profiles.map((p) => p.id);

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
						<ImportButton
							onBundle={(bundle) => {
								setImportBundle(bundle);
								setImportOpen(true);
							}}
						/>
					}
					className="bg-card border rounded-xl h-full"
				>
					<SidebarGroupContainer>
						{profiles.map((p) => (
							<SidebarEntry
								key={p.id}
								id={p.id}
								onClick={() => {
									setSelectedId(p.id);
									setShowCreate(false);
								}}
							>
								<div className="flex items-center gap-2 w-full">
									<div className="text-[13px] font-medium truncate">
										{p.name}
									</div>
									<InlineDeleteButton
										isPending={deleteMutation.isPending}
										isActive={deleteMutation.variables === p.id}
										onClick={(e) => {
											e.stopPropagation();
											deleteMutation.mutate(p.id);
										}}
									/>
								</div>
								<div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground/60">
									<span className="flex items-center gap-0.5">
										<Cpu className="size-3" />
										{engines.find((e) => e.id === p.default_engine_id)?.name ??
											`Engine #${p.default_engine_id}`}
									</span>
									<span className="flex items-center gap-0.5">
										<Zap className="size-3" />
										{resolvers.find((r) => r.id === p.resolver_id)?.name ??
											`Resolver #${p.resolver_id}`}
									</span>
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
				<ProfileDetail
					profile={profiles.find((p) => p.id === selectedId)}
					onBack={() => setSelectedId(null)}
					onDelete={() => {
						deleteMutation.mutate(selectedId);
						setSelectedId(null);
					}}
					deleting={deleteMutation.isPending}
				/>
			) : (
				<EmptyDetail icon={Settings} text="Select a profile" />
			)}
			<ImportDialog
				open={importOpen}
				onClose={() => setImportOpen(false)}
				onImported={() =>
					queryClient.invalidateQueries({ queryKey: ["profiles"] })
				}
				bundle={importBundle}
			/>
		</ResizableSidebar>
	);
}

function BulkActions() {
	const { mutate: deleteMutate, isPending: deletePending, selectedIds } = useBulkDelete(
		(id: number) => profilesApi.delete(id),
		"Profiles",
	);
	const count = selectedIds.size;
	const { handleExport } = useBulkExport(
		(id: number) => importExportApi.exportProfile(id),
		"profile",
		"profile",
	);
	return (
		<>
			<Button
				variant="ghost"
				size="sm"
				className="h-6 text-[10px]"
				onClick={handleExport}
			>
				<Download className="size-3 mr-1" />
				Bulk Export
			</Button>
			<DeleteConfirm
				entityName={`${count} profile(s)`}
				isPending={deletePending}
				onConfirm={deleteMutate}
			>
				<Button
					variant="ghost"
					size="sm"
					className="h-6 text-[10px] text-destructive hover:text-destructive"
					disabled={deletePending || count === 0}
				>
					{deletePending ? (
						<Loader2 className="size-3 mr-1 animate-spin" />
					) : (
						<Trash2 className="size-3 mr-1" />
					)}
					Bulk Delete ({count})
				</Button>
			</DeleteConfirm>
		</>
	);
}

function ProfileDetail({
	profile,
	onBack,
	onDelete,
	deleting,
}: {
	profile: Profile | undefined;
	onBack: () => void;
	onDelete: () => void;
	deleting: boolean;
}) {
	const { data: engines = [] } = useEngines();
	const { data: resolvers = [] } = useResolvers();

	if (!profile) return null;
	const engine = engines.find((e) => e.id === profile.default_engine_id);
	const resolver = resolvers.find((r) => r.id === profile.resolver_id);
	return (
		<DetailLayout
			header={
				<DetailHeader
					onBack={onBack}
					title={profile.name}
					actions={
						<div className="flex items-center gap-1">
							<ExportButton
								onExport={() => importExportApi.exportProfile(profile.id)}
								filename={profile.name}
							/>
							<DeleteConfirm
								entityName="Profile"
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
						</div>
					}
				/>
			}
		>
			<InfoGrid
				fields={[
					{ label: "Name", value: profile.name },
					{
						label: "Retry Mode",
						value: profile.retry_mode ?? "none",
					},
					{
						label: "Engine",
						value: engine?.name ?? `#${profile.default_engine_id}`,
					},
					{
						label: "Resolver",
						value: resolver?.name ?? `#${profile.resolver_id}`,
					},
				]}
			/>
			<KeyValueTable
				title="Resolver Config"
				entries={Object.entries(profile.resolver_config ?? {})}
				json={profile.resolver_config}
				emptyText="None"
			/>
			<KeyValueTable
				title="Retry Config"
				entries={Object.entries(profile.retry_config ?? {})}
				json={profile.retry_config}
				emptyText="None"
			/>
		</DetailLayout>
	);
}

function CreateProfilePanel({ onClose }: { onClose: () => void }) {
	const config = usePluginConfig();
	const [name, setName] = useState("");

	const createMutation = useMutation({
		mutationFn: (data: Record<string, unknown>) =>
			profilesApi.create(data) as unknown as Promise<void>,
		onSuccess: () => {
			onClose();
			toast.success("Profile created");
		},
		onError: (err: Error) =>
			toast.error(`Failed to create profile: ${err.message}`),
	});

	return (
		<CreatePanel
			title="New Profile"
			onClose={onClose}
			submitLabel="Create Profile"
			onSubmit={() =>
				createMutation.mutate({
					name,
					default_engine_id: parseInt(config.engineId, 10),
					resolver_id: parseInt(config.resolverId, 10),
					retry_mode: config.retryMode,
					resolver_config: config.resolverConfig,
					retry_config: config.retryConfig,
				})
			}
			isPending={createMutation.isPending}
			canSubmit={!!name && !!config.engineId && !!config.resolverId}
		>
			<FormField label="Name">
				<Input
					value={name}
					onChange={(e) => setName(e.target.value)}
					className="h-8 text-xs"
					placeholder="My Profile"
				/>
			</FormField>
			<PluginConfigFields
				engineId={config.engineId}
				resolverId={config.resolverId}
				retryMode={config.retryMode}
				retryConfig={config.retryConfig}
				resolverConfig={config.resolverConfig}
				availableRetryModes={config.availableRetryModes}
				retryModeSchema={config.retryModeSchema}
				resolverConfigSchema={config.resolverConfigSchema}
				engines={config.engines}
				resolvers={config.resolvers}
				onEngineChange={config.handleEngineChange}
				onResolverChange={config.handleResolverChange}
				onRetryModeChange={config.handleRetryModeChange}
				onRetryConfigChange={config.setRetryConfig}
				onResolverConfigChange={config.setResolverConfig}
			/>
		</CreatePanel>
	);
}
