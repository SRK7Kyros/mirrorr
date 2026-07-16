import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Cpu, Download, Loader2, Settings, Trash2, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PluginConfigFields } from "@/components/config-fields";
import { FormField } from "@/components/form-field";
import { ImportDialog } from "@/components/import-dialog";
import { ExportButton, ImportButton } from "@/components/import-export-buttons";
import { InfoGrid } from "@/components/info-grid";
import { InlineDeleteButton } from "@/components/inline-delete-button";
import { KeyValueTable } from "@/components/key-value-table";
import { ResizableSidebar } from "@/components/resizable-sidebar";
import {
	BulkActionBar,
	CreatePanel,
	DetailHeader,
	DetailLayout,
	EmptyDetail,
	SidebarEntry,
	SidebarGroupContainer,
	SidebarLayout,
} from "@/components/resource-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBulkDelete } from "@/hooks/use-bulk-delete";
import { useBulkExport } from "@/hooks/use-bulk-export";
import { MultiSelectProvider } from "@/hooks/use-multi-select";
import { usePluginConfig } from "@/hooks/use-plugin-config";
import { useEngines, useProfiles, useResolvers } from "@/hooks/use-queries";
import { importExportApi, profilesApi } from "@/lib/api";
import type { Profile } from "@/lib/schemas";

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
										id={p.id}
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
	const { mutate: deleteMutate, isPending: deletePending } = useBulkDelete(
		(id: number) => profilesApi.delete(id),
		"Profiles",
	);
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
			<Button
				variant="ghost"
				size="sm"
				className="h-6 text-[10px] text-destructive hover:text-destructive"
				onClick={deleteMutate}
				disabled={deletePending}
			>
				{deletePending ? (
					<Loader2 className="size-3 mr-1 animate-spin" />
				) : (
					<Trash2 className="size-3 mr-1" />
				)}
				Bulk Delete
			</Button>
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
							<Button
								variant="ghost"
								size="sm"
								className="h-7 text-xs text-destructive"
								onClick={onDelete}
								onKeyDown={(e) => {
									if (e.key === "Delete" || e.key === "Backspace") {
										e.preventDefault();
										onDelete();
									}
								}}
								onContextMenu={(e) => {
									e.preventDefault();
									onDelete();
								}}
								disabled={deleting}
							>
								{deleting ? (
									<Loader2 className="size-3 mr-1 animate-spin" />
								) : (
									<Trash2 className="size-3 mr-1" />
								)}
								Delete
							</Button>
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
		mutationFn: (data: Record<string, unknown>) => profilesApi.create(data),
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
