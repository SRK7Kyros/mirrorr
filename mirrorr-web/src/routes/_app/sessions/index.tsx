import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sessionsApi } from "@/lib/api";
import { createSessionSchema } from "@/lib/schemas";
import type { Session, Autorun } from "@/lib/schemas";
import { BulkDeleteButton } from "@/components/bulk-delete-button";
import { Button } from "@/components/ui/button";
import { DeleteConfirm } from "@/components/delete-confirm";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
	Trash2,
	Radio,
	Loader2,
	ChevronDown,
	ChevronRight,
	Square,
} from "lucide-react";
import { SessionLogsViewer } from "@/components/session-logs-viewer";
import { RecordingProgressBar } from "@/components/recording-progress-bar";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { InfoGrid } from "@/components/info-grid";
import { KeyValueTable } from "@/components/key-value-table";
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
import { FormField } from "@/components/form-field";
import { ResizableSidebar } from "@/components/resizable-sidebar";
import { formatDuration, formatLocalDate, parseUtcDate, describeCascade, isSessionDeleteBlocked, sessionDeleteBlockedReason, getStatusDotColor } from "@/lib/utils";
import { useState, useMemo, useEffect, useRef } from "react";
import { MultiSelectProvider } from "@/hooks/use-multi-select";
import { usePluginConfig } from "@/hooks/use-plugin-config";
import { PluginConfigFields } from "@/components/config-fields";
import {
	useSessions,
	useAutoruns,
	useProfiles,
	useEngines,
	useResolvers,
} from "@/hooks/use-queries";
import { useSaveAsProfile } from "@/hooks/use-save-as-profile";
import { SaveAsProfileButton } from "@/components/save-as-profile-button";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/sessions/")({
	component: SessionsPage,
});

function SessionsPage() {
	const [showCreate, setShowCreate] = useState(false);
	const [selectedId, setSelectedId] = useState<number | null>(null);

	const { data: sessions = [], isLoading } = useSessions();

	const { data: autoruns = [] } = useAutoruns();

	const queryClient = useQueryClient();

	const autorunMap = useMemo(
		() => Object.fromEntries(autoruns.map((a) => [a.id, a])),
		[autoruns],
	);

	const [deletingId, setDeletingId] = useState<number | null>(null);

	const deleteMutation = useMutation({
		mutationFn: (id: number) => sessionsApi.delete(id),
		onSuccess: (res) => {
			const cascade = describeCascade(res);
			toast.success(
				cascade ? `Session deleted — also removed ${cascade}` : "Session deletion requested",
			);
		},
		onError: (err: Error) => {
			toast.error(`Failed to delete session: ${err.message}`);
			setDeletingId(null);
		},
	});
	const toggleRecMutation = useMutation({
		mutationFn: (session: Session) =>
			session.recording
				? sessionsApi.disableRecording(session.id)
				: sessionsApi.enableRecording(session.id),
		onError: (err: Error) =>
			toast.error(`Failed to toggle recording: ${err.message}`),
	});
	const stopMutation = useMutation({
		mutationFn: (id: number) => sessionsApi.stop(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["sessions"] });
			toast.success("Session stop requested");
		},
		onError: (err: Error) => toast.error(`Failed to stop session: ${err.message}`),
	});

	const sessionIds = sessions.map((s) => s.id);

	const live = sessions
		.filter((s) => s.status === "active" || s.status === "recording")
		.slice(0, 20);

	// Derive effective deletingId: clear automatically when session disappears from list
	const effectiveDeletingId =
		deletingId !== null && sessions.some((s) => s.id === deletingId)
			? deletingId
			: null;

	return (
		<ResizableSidebar>
			<MultiSelectProvider allIds={sessionIds}>
				<SidebarLayout
					title="Sessions"
					count={sessions.length}
					countLabel="total"
					onNew={() => setShowCreate(true)}
					isLoading={isLoading}
					emptyText="No sessions"
					headerExtra={
						live.length > 0 ? (
							<div className="px-3 pb-2 flex gap-2 overflow-x-auto">
								{live.map((s) => {
									const { completedDuration, runningAttempt } =
										getSessionTiming(s);
									return (
										<div
											key={s.id}
											className="shrink-0 flex items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5"
										>
											<span
												className={`size-2 rounded-full shrink-0 ${getStatusDotColor(s.status)}`}
											/>
											<button
												type="button"
												className="text-xs font-medium truncate max-w-[120px] hover:underline"
												onClick={() => {
													setSelectedId(s.id);
													setShowCreate(false);
												}}
											>
												{s.autorun_id
													? (autorunMap[s.autorun_id]?.user_friendly_name ??
														`Session #${s.id}`)
													: `Session #${s.id}`}
											</button>
											<span className="text-micro text-muted-foreground tabular-nums">
												<LiveCountup
													startedAt={runningAttempt?.started_at ?? null}
													offset={completedDuration}
												/>
											</span>
											<button
												type="button"
												className="text-micro text-muted-foreground hover:text-foreground"
												title="Stop session"
												onClick={() => stopMutation.mutate(s.id)}
											>
												<Square className="size-3" />
											</button>
											<button
												type="button"
												className={`text-micro hover:text-foreground ${s.recording ? "text-red-500" : "text-muted-foreground"}`}
												title={s.recording ? "Recording on" : "Recording off"}
												onClick={() => toggleRecMutation.mutate(s)}
											>
												<span
													className={`size-2 rounded-full inline-block ${s.recording ? "bg-red-500" : "bg-muted-foreground/30"}`}
												/>
											</button>
										</div>
									);
								})}
							</div>
						) : undefined
					}
				>
					<SidebarGroupContainer>
						{sessions.map((s) => (
							<SessionEntry
								key={s.id}
								session={s}
								autorun={s.autorun_id ? autorunMap[s.autorun_id] : undefined}
								onClick={() => {
									setSelectedId(s.id);
									setShowCreate(false);
								}}
							/>
						))}
					</SidebarGroupContainer>
				</SidebarLayout>
				<BulkActionBar
					actions={
						<BulkDeleteButton
							deleteFn={sessionsApi.delete}
							entityLabel="session"
							entityLabelPlural="Sessions"
							isBlocked={(id) =>
								isSessionDeleteBlocked(
									sessions.find((s) => s.id === id)?.status,
								)
							}
							blockedReason={sessionDeleteBlockedReason()}
						/>
					}
				/>
			</MultiSelectProvider>
			{showCreate ? (
				<CreateSessionPanel onClose={() => setShowCreate(false)} />
			) : selectedId ? (
				<SessionDetail
					session={sessions.find((s) => s.id === selectedId)}
					onBack={() => setSelectedId(null)}
					onDelete={() => {
						setDeletingId(selectedId);
						deleteMutation.mutate(selectedId);
					}}
					onToggleRec={() => {
						const session = sessions.find((s) => s.id === selectedId);
						if (session) toggleRecMutation.mutate(session);
					}}
					onStop={() => stopMutation.mutate(selectedId)}
					stopping={stopMutation.isPending}
					deleting={effectiveDeletingId === selectedId}
				/>
			) : (
				<EmptyDetail
					icon={Radio}
					text="Select a session or create one"
					actions={
						<Button
							variant="outline"
							size="sm"
							className="h-7 text-xs"
							onClick={() => setShowCreate(true)}
						>
							New Session
						</Button>
					}
				/>
			)}
		</ResizableSidebar>
	);
}

function getSessionTiming(session: Session) {
	const completedDuration = (session.attempts || [])
		.filter((a) => a.duration_seconds != null)
		.reduce((sum: number, a) => sum + (a.duration_seconds ?? 0), 0);
	const runningAttempt = (session.attempts || []).find(
		(a) => a.ended_at == null,
	);
	return { completedDuration, runningAttempt };
}

function SessionEntry({
	session,
	autorun,
	onClick,
}: {
	session: Session;
	autorun?: Autorun;
	onClick: () => void;
}) {
	const displayName = autorun?.user_friendly_name ?? `Session #${session.id}`;
	const { completedDuration, runningAttempt } = getSessionTiming(session);

	return (
		<SidebarEntry
			id={session.id}
			onClick={onClick}
			className="grid grid-cols-[1fr_auto] items-start gap-x-2 gap-y-0"
		>
			<span className="text-[13px] font-medium truncate mt-px">
				{displayName}
			</span>
			<StatusBadge status={session.status} className="mt-px" />
			<div className="col-span-2 mt-1 flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
				<LiveCountup
					startedAt={runningAttempt?.started_at ?? null}
					offset={completedDuration}
				/>
			</div>
		</SidebarEntry>
	);
}

/**
 * Live-updating elapsed time counter. Shows `offset + (now - startedAt)`.
 * - `startedAt`: ISO timestamp to count from
 * - `offset`: seconds already elapsed (e.g. sum of completed attempts)
 * Ticks every 1s. When `startedAt` is null, just shows `offset` statically.
 */
function LiveCountup({
	startedAt,
	offset = 0,
}: {
	startedAt: string | null;
	offset?: number;
}) {
	const [elapsed, setElapsed] = useState(() => {
		if (!startedAt) return offset;
		return (
			offset +
			(Date.now() - (parseUtcDate(startedAt)?.getTime() ?? Date.now())) / 1000
		);
	});

	useEffect(() => {
		if (!startedAt) return;
		const update = () =>
			setElapsed(
				offset +
					(Date.now() - (parseUtcDate(startedAt)?.getTime() ?? Date.now())) /
						1000,
			);
		update();
		const id = setInterval(update, 1000);
		return () => clearInterval(id);
	}, [startedAt, offset]);

	return <span className="tabular-nums">{formatDuration(elapsed)}</span>;
}

function SessionDetail({
	session,
	onBack,
	onDelete,
	onToggleRec,
	onStop,
	stopping,
	deleting,
}: {
	session: Session | undefined;
	onBack: () => void;
	onDelete: () => void;
	onToggleRec: () => void;
	onStop: () => void;
	stopping: boolean;
	deleting: boolean;
}) {
	const saveAsProfile = useSaveAsProfile(
		(sessionId: number, name: string) =>
			sessionsApi.saveAsProfile(sessionId, name),
		"session",
	);

	const { data: profiles = [] } = useProfiles();
	const { data: engines = [] } = useEngines();
	const { data: resolvers = [] } = useResolvers();

	// 3-state recording switch: original → pending (center) → confirmed (final)
	// Track toggle initiation via ref (no render), clear via effect when recording state changes
	const recTogglePending = useRef(false);
	const [recPending, setRecPending] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: session?.recording is a trigger dep — the effect must re-run when recording state changes but does not read the value inside the body
	useEffect(() => {
		if (recTogglePending.current) {
			recTogglePending.current = false;
			setRecPending(false);
		}
	}, [session?.recording]);

	if (!session) return null;

	const { completedDuration, runningAttempt } = getSessionTiming(session);

	const profile = profiles.find((p) => p.id === session.profile_id);
	const engine = engines.find((e) => e.id === session.engine_id);
	const resolver = resolvers.find((r) => r.id === session.resolver_id);

	return (
		<DetailLayout
			header={
				<DetailHeader
					onBack={onBack}
					title={`Session #${session.id}`}
					actions={
						<div className="flex items-center gap-3">
							{/* Save as Profile — only when session has no profile */}
							{!session.profile_id && (
								<SaveAsProfileButton
									open={saveAsProfile.open}
									onOpen={() => saveAsProfile.setOpen(true)}
									name={saveAsProfile.name}
									onNameChange={saveAsProfile.setName}
									onSave={() => saveAsProfile.save(session.id)}
									onCancel={() => {
										saveAsProfile.setOpen(false);
										saveAsProfile.setName("");
									}}
									isPending={saveAsProfile.isPending}
								/>
							)}

								{(session.status === "active" || session.status === "recording") && (
								<Button
									variant="outline"
									size="sm"
									className="h-11 min-h-[44px] text-xs"
									disabled={stopping}
									onClick={onStop}
								>
									{stopping ? (
										<Loader2 className="size-3 mr-1 animate-spin" />
									) : (
										<Square className="size-3 mr-1" />
									)}
									Stop
								</Button>
							)}
							<div className="flex items-center gap-2 min-h-[44px]">
								<Label className="text-xs text-muted-foreground">
									Recording
								</Label>
								<Switch
									checked={!!session.recording}
									pending={recPending}
									onCheckedChange={() => {
										recTogglePending.current = true;
										setRecPending(true);
										onToggleRec();
									}}
								/>
							</div>
							<DeleteConfirm
								entityName="Session"
								isPending={deleting}
								onConfirm={onDelete}
								disabled={isSessionDeleteBlocked(session?.status)}
								disabledReason={sessionDeleteBlockedReason()}
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
					{
						label: "Status",
						value: <StatusBadge status={session.status} />,
					},
					{
						label: "Duration",
						value: (
							<LiveCountup
								startedAt={runningAttempt?.started_at ?? null}
								offset={completedDuration}
							/>
						),
					},
					{
						label: "Profile",
						value:
							profile?.name ??
							session.profile_name ??
							(session.profile_id ? `#${session.profile_id}` : "None (manual)"),
					},
					{
						label: "Engine",
						value: engine?.name ?? session.engine_name ?? `#${session.engine_id}`,
					},
					{
						label: "Resolver",
						value: resolver?.name ?? session.resolver_name ?? `#${session.resolver_id}`,
					},
				]}
			/>
			<div className="flex gap-6">
				{session.started_at && (
					<div className="space-y-1 shrink-0">
						<Label className="text-xs text-muted-foreground">Started</Label>
						<p className="text-xs">{formatLocalDate(session.started_at)}</p>
					</div>
				)}
				{session.ended_at && (
					<div className="space-y-1 shrink-0">
						<Label className="text-xs text-muted-foreground">Ended</Label>
						<p className="text-xs">{formatLocalDate(session.ended_at)}</p>
					</div>
				)}
			</div>
			<RecordingProgressBar sessionId={session.id} status={session.status} />
			{session.session_urls?.length > 0 ? (
				<KeyValueTable
					title="Public URLs"
					leftAlignValues
					entries={session.session_urls.map(
						(entry: Record<string, unknown>) => [
							String(entry.label ?? ""),
							<a
								key={String(entry.url ?? "")}
								href={String(entry.url ?? "")}
								target="_blank"
								rel="noopener noreferrer"
								className="text-xs font-mono text-foreground/80 hover:text-foreground hover:underline"
							>
								{String(entry.url ?? "")}
							</a>,
						],
					)}
				/>
			) : (
				<p className="text-xs text-muted-foreground/70">
					Live URLs unavailable — the session has no public URLs yet.
				</p>
			)}
			<SessionLogsViewer
				sessionId={session.id}
				active={
					session.status === "active" ||
					session.status === "recording" ||
					session.status === "terminating"
				}
			/>
			{session.attempts?.length > 0 && (
				<div className="space-y-1.5">
					<Label className="text-xs text-muted-foreground">
						Attempts ({session.attempts.length})
					</Label>
					<div className="border rounded-lg overflow-hidden">
						<Table>
							<TableHeader>
								<TableRow className="h-7">
									<TableHead className="text-micro font-medium h-7 px-2">
										#
									</TableHead>
									<TableHead className="text-micro font-medium h-7 px-2">
										Started
									</TableHead>
									<TableHead className="text-micro font-medium h-7 px-2">
										Ended
									</TableHead>
									<TableHead className="text-micro font-medium h-7 px-2">
										Duration
									</TableHead>
									<TableHead className="text-micro font-medium h-7 px-2">
										Exit Code
									</TableHead>
									<TableHead className="text-micro font-medium h-7 px-2">
										Reason
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{[...session.attempts].reverse().map((a) => (
									<TableRow key={a.index} className="h-7">
										<TableCell className="text-xs font-mono px-2 py-1">
											{a.index}
										</TableCell>
										<TableCell className="text-xs font-mono px-2 py-1 text-muted-foreground">
											{a.started_at ? formatLocalDate(a.started_at) : "—"}
										</TableCell>
										<TableCell className="text-xs font-mono px-2 py-1 text-muted-foreground">
											{a.ended_at ? (
												formatLocalDate(a.ended_at)
											) : (
												<span className="inline-flex items-center gap-1">
													<Loader2 className="size-3 animate-spin" />
													running…
												</span>
											)}
										</TableCell>
										<TableCell className="text-xs font-mono px-2 py-1 text-muted-foreground tabular-nums">
											{a.duration_seconds != null ? (
												formatDuration(a.duration_seconds)
											) : a.ended_at == null ? (
												<LiveCountup startedAt={a.started_at ?? null} />
											) : (
												"—"
											)}
										</TableCell>
										<TableCell className="text-xs font-mono px-2 py-1">
											{a.returncode != null ? (
												<span
													className={
														a.returncode === 0
															? "text-emerald-500"
															: "text-red-500"
													}
												>
													{a.returncode}
												</span>
											) : (
												<span className="text-muted-foreground/40">—</span>
											)}
										</TableCell>
										<TableCell className="text-xs font-mono px-2 py-1 text-muted-foreground max-w-[200px] truncate">
											{a.reason ?? "—"}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				</div>
			)}
		</DetailLayout>
	);
}

function CreateSessionPanel({ onClose }: { onClose: () => void }) {
	const queryClient = useQueryClient();
	const config = usePluginConfig();
	const [recording, setRecording] = useState(false);

	const createMutation = useMutation({
		mutationFn: (data: Record<string, unknown>) =>
			sessionsApi.create(createSessionSchema.parse(data)),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["sessions"] });
			onClose();
			toast.success("Session created");
		},
		onError: (err: Error) =>
			toast.error(`Failed to create session: ${err.message}`),
	});

	const canSubmit = config.showConfigFields
		? !!(config.engineId && config.resolverId)
		: !!config.hasProfile;

	return (
		<CreatePanel
			title="New Session"
			onClose={onClose}
			submitLabel="Start Session"
			onSubmit={() => {
				const data: Record<string, unknown> = { recording };
				if (config.hasProfile) data.profile_id = parseInt(config.profileId, 10);
				if (config.showConfigFields) {
					if (config.engineId) data.engine_id = parseInt(config.engineId, 10);
					if (config.resolverId)
						data.resolver_id = parseInt(config.resolverId, 10);
					data.retry_mode = config.retryMode;
					data.retry_config = config.retryConfig;
					data.resolver_config = config.resolverConfig;
				} else if (config.selectedProfile) {
					data.engine_id = config.selectedProfile.default_engine_id;
					data.resolver_id = config.selectedProfile.resolver_id;
					data.retry_mode = config.selectedProfile.retry_mode ?? "none";
					data.retry_config = config.selectedProfile.retry_config ?? {};
					data.resolver_config = config.selectedProfile.resolver_config ?? {};
				}
				createMutation.mutate(data);
			}}
			isPending={createMutation.isPending}
			canSubmit={canSubmit}
		>
			<FormField label="Profile">
				<Select
					value={config.profileId}
					onValueChange={config.handleProfileChange}
					items={[
						{
							value: "__none__",
							label: "None — configure manually",
						},
						...config.profiles.map((p) => ({
							value: String(p.id),
							label: p.name,
						})),
					]}
				>
					<SelectTrigger className="h-8 text-xs w-full">
						<SelectValue placeholder="None — configure manually" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="__none__">None — configure manually</SelectItem>
						{config.profiles.map((p) => (
							<SelectItem key={p.id} value={String(p.id)}>
								{p.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</FormField>

			{config.hasProfile && (
				<Collapsible
					open={config.advancedOpen}
					onOpenChange={config.setAdvancedOpen}
				>
					<CollapsibleTrigger
						render={
							<button
								type="button"
								className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
							/>
						}
					>
						{config.advancedOpen ? (
							<ChevronDown className="size-3" />
						) : (
							<ChevronRight className="size-3" />
						)}
						Advanced — override profile settings
					</CollapsibleTrigger>
					<CollapsibleContent className="space-y-3 mt-2">
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
					</CollapsibleContent>
				</Collapsible>
			)}

			{!config.hasProfile && (
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
			)}

			<div className="flex items-center justify-between">
				<Label className="text-xs">Recording</Label>
				<Switch checked={recording} onCheckedChange={setRecording} />
			</div>
		</CreatePanel>
	);
}
