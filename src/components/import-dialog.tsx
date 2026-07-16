import { useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	CalendarClock,
	Check,
	CheckCircle2,
	ChevronRight,
	Copy,
	Cpu,
	Filter,
	Info,
	Package,
	Search,
	Trash2,
	UserCheck,
	Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { importExportApi } from "@/lib/api";
import { AREAS, PLUGIN_CELLS, TIME_RANGE } from "@/lib/layouts";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────

type PluginRef = { name: string; origin_hash: string };
interface Issue {
	field?: string;
	problem: string;
	bundled?: PluginRef;
	installed?: PluginRef;
	alternatives?: Array<{ id: number; name: string; origin_hash: string }>;
	existing_id?: number;
	profile_name?: string;
	new_name?: string;
}
interface ProfileResult {
	name: string;
	content_hash: string;
	valid: boolean;
	issues: Issue[];
}
interface AutorunResult {
	name: string;
	valid: boolean;
	issues: Issue[];
}
interface ValidationReport {
	valid: boolean;
	profiles: ProfileResult[];
	autoruns: AutorunResult[];
}
type Phase = "loading" | "confirm" | "resolve";
type FilterStatus = "all" | "ready" | "issue" | "removed";
type BundleItem = {
	id: string;
	type: "profile" | "autorun";
	data: Record<string, unknown>;
	status: "ok" | "skip" | "rename" | "issue";
	issues: Issue[];
	removed: boolean;
};

// ── Main Dialog ───────────────────────────────────────────────

export function ImportDialog({
	open,
	onClose,
	onImported,
	bundle,
}: {
	open: boolean;
	onClose: () => void;
	onImported: () => void;
	bundle: Record<string, unknown> | null;
}) {
	const queryClient = useQueryClient();
	const [phase, setPhase] = useState<Phase>("loading");
	const [report, setReport] = useState<ValidationReport | null>(null);
	const [pluginMap, setPluginMap] = useState<
		Record<string, { type: string; id: number }>
	>({});
	const [importing, setImporting] = useState(false);
	const [items, setItems] = useState<BundleItem[]>([]);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [search, setSearch] = useState("");
	const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
	const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
	const lastClickedId = useRef<string | null>(null);
	const onCloseRef = useRef(onClose);
	useEffect(() => {
		onCloseRef.current = onClose;
	}, [onClose]);
	useEffect(() => {
		onCloseRef.current = onClose;
	}, [onClose]);

	// Reset state when dialog opens
	/* eslint-disable react-hooks/set-state-in-effect */
	useEffect(() => {
		if (!open || !bundle) return;
		setPhase("loading");
		setPluginMap({});
		setItems([]);
		setSelectedIds(new Set());
		setSearch("");
		setFilterStatus("all");
		setExpandedIds(new Set());
		lastClickedId.current = null;

		importExportApi
			.validate(bundle)
			.then((data) => {
				setReport(data as unknown as ValidationReport);
				const r = data as unknown as ValidationReport;

				// Build initial plugin mappings
				const initialMap: Record<string, { type: string; id: number }> = {};
				for (const p of r.profiles) {
					for (const issue of p.issues) {
						if (issue.bundled && issue.alternatives?.length) {
							const best =
								issue.alternatives.find(
									(a) => a.name === issue.bundled?.name,
								) ?? issue.alternatives[0];
							initialMap[issue.bundled.origin_hash] = {
								type: issue.field ?? "",
								id: best.id,
							};
						}
					}
				}
				for (const a of r.autoruns) {
					for (const issue of a.issues) {
						if (issue.bundled && issue.alternatives?.length) {
							const best =
								issue.alternatives.find(
									(al) => al.name === issue.bundled?.name,
								) ?? issue.alternatives[0];
							initialMap[issue.bundled.origin_hash] = {
								type: issue.field ?? "",
								id: best.id,
							};
						}
					}
				}
				setPluginMap(initialMap);

				// Build items list
				const rawProfiles =
					(bundle.profiles as Array<Record<string, unknown>>) ?? [];
				const rawAutoruns =
					(bundle.autoruns as Array<Record<string, unknown>>) ?? [];
				const bundleItems: BundleItem[] = [];

				for (let i = 0; i < rawProfiles.length; i++) {
					const p = rawProfiles[i];
					const profileReport = r.profiles[i];
					const issues = profileReport?.issues ?? [];
					const status =
						issues.length === 0
							? ("ok" as const)
							: issues.some((iss) => iss.problem === "already_exists")
								? ("skip" as const)
								: issues.some((iss) => iss.problem === "name_conflict")
									? ("rename" as const)
									: ("issue" as const);
					bundleItems.push({
						id: `profile-${i}`,
						type: "profile",
						data: p,
						status,
						issues,
						removed: false,
					});
				}

				for (let i = 0; i < rawAutoruns.length; i++) {
					const a = rawAutoruns[i];
					const autorunReport = r.autoruns[i];
					const issues = autorunReport?.issues ?? [];
					const status =
						issues.length === 0 ? ("ok" as const) : ("issue" as const);
					bundleItems.push({
						id: `autorun-${i}`,
						type: "autorun",
						data: a,
						status,
						issues,
						removed: false,
					});
				}

				setItems(bundleItems);
				setPhase(r.valid ? "confirm" : "resolve");
			})
			.catch((err) => {
				toast.error(`Validation failed: ${err.message}`);
				onCloseRef.current();
			});
	}, [open, bundle]);

	// Computed values
	const filteredItems = useMemo(() => {
		return items.filter((item) => {
			// Search filter
			if (search) {
				const q = search.toLowerCase();
				const name =
					(item.data.name as string) ??
					(item.data.user_friendly_name as string) ??
					"";
				const engineName =
					(item.data.default_engine as PluginRef)?.name ?? "";
				const resolverName = (item.data.resolver as PluginRef)?.name ?? "";
				if (
					!name.toLowerCase().includes(q) &&
					!engineName.toLowerCase().includes(q) &&
					!resolverName.toLowerCase().includes(q)
				) {
					return false;
				}
			}
			// Status filter
			if (filterStatus === "ready") return item.status === "ok" && !item.removed;
			if (filterStatus === "issue")
				return (
					(item.status === "issue" || item.status === "rename") && !item.removed
				);
			if (filterStatus === "removed") return item.removed;
			return true;
		});
	}, [items, search, filterStatus]);

	const stats = useMemo(() => {
		const total = items.length;
		const profiles = items.filter((i) => i.type === "profile").length;
		const autoruns = items.filter((i) => i.type === "autorun").length;
		const issues = items.filter(
			(i) => (i.status === "issue" || i.status === "rename") && !i.removed,
		).length;
		const removed = items.filter((i) => i.removed).length;
		return { total, profiles, autoruns, issues, removed };
	}, [items]);

	const allResolved = useMemo(() => {
		if (!report) return false;
		for (const item of items) {
			if (item.removed) continue;
			if (item.status === "ok" || item.status === "skip") continue;
			if (item.status === "rename") continue;
			for (const issue of item.issues) {
				if (
					issue.problem === "name_conflict" ||
					issue.problem === "already_exists"
				)
					continue;
				if (issue.bundled && !pluginMap[issue.bundled.origin_hash])
					return false;
			}
		}
		return true;
	}, [items, pluginMap, report]);

	// Selection handlers
	const handleItemClick = useCallback(
		(id: string, e: React.MouseEvent) => {
			const item = items.find((i) => i.id === id);
			if (!item || item.removed) return;

			if (e.shiftKey && lastClickedId.current !== null) {
				// Range select
				const allVisibleIds = filteredItems
					.filter((i) => !i.removed)
					.map((i) => i.id);
				const fromIdx = allVisibleIds.indexOf(lastClickedId.current);
				const toIdx = allVisibleIds.indexOf(id);
				if (fromIdx !== -1 && toIdx !== -1) {
					const start = Math.min(fromIdx, toIdx);
					const end = Math.max(fromIdx, toIdx);
					const rangeIds = allVisibleIds.slice(start, end + 1);
					setSelectedIds((prev) => {
						const next = new Set(prev);
						for (const rid of rangeIds) next.add(rid);
						return next;
					});
				}
			} else if (e.ctrlKey || e.metaKey) {
				// Toggle single
				setSelectedIds((prev) => {
					const next = new Set(prev);
					if (next.has(id)) next.delete(id);
					else next.add(id);
					return next;
				});
			} else {
				// Plain click — select only this
				setSelectedIds(new Set([id]));
			}
			lastClickedId.current = id;
		},
		[items, filteredItems],
	);

	const toggleExpand = useCallback((id: string) => {
		setExpandedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);

	// Batch actions
	const handleSelectAll = useCallback(() => {
		const visibleIds = filteredItems.filter((i) => !i.removed).map((i) => i.id);
		setSelectedIds(new Set(visibleIds));
	}, [filteredItems]);

	const handleDeselectAll = useCallback(() => {
		setSelectedIds(new Set());
	}, []);

	const handleRemoveSelected = useCallback(() => {
		setItems((prev) =>
			prev.map((item) =>
				selectedIds.has(item.id) ? { ...item, removed: true } : item,
			),
		);
		setSelectedIds(new Set());
	}, [selectedIds]);

	const handleReincludeSelected = useCallback(() => {
		setItems((prev) =>
			prev.map((item) =>
				selectedIds.has(item.id) ? { ...item, removed: false } : item,
			),
		);
		setSelectedIds(new Set());
	}, [selectedIds]);

	// Import handler
	const handleImport = useCallback(async () => {
		if (!bundle) return;
		setImporting(true);
		try {
			const removedProfiles = items
				.filter((i) => i.type === "profile" && i.removed)
				.map((i) => (i.data.name as string) ?? "untitled");
			const removedAutoruns = items
				.filter((i) => i.type === "autorun" && i.removed)
				.map((i) => (i.data.user_friendly_name as string) ?? "untitled");

			const result = await importExportApi.apply(
				bundle,
				pluginMap,
				removedProfiles,
				removedAutoruns,
			);
			const msgs: string[] = [];
			if (result.profiles_created)
				msgs.push(`${result.profiles_created} profile(s) created`);
			if (result.autoruns_created)
				msgs.push(`${result.autoruns_created} autorun(s) created`);
			if (result.profiles_skipped)
				msgs.push(`${result.profiles_skipped} profile(s) skipped (identical)`);
			toast.success(msgs.length ? msgs.join(", ") : "Import complete");
			queryClient.invalidateQueries({ queryKey: ["profiles"] });
			queryClient.invalidateQueries({ queryKey: ["autoruns"] });
			onImported();
			onClose();
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : "Import failed";
			toast.error(msg);
		} finally {
			setImporting(false);
		}
	}, [bundle, pluginMap, items, queryClient, onImported, onClose]);

	const setPluginMapping = useCallback(
		(hash: string, type: string, id: number) => {
			setPluginMap((prev) => ({ ...prev, [hash]: { type, id } }));
		},
		[],
	);

	const activeCount = items.filter((i) => !i.removed).length;

	return (
		<Dialog open={open} onOpenChange={(v) => !v && onClose()}>
			<DialogContent className="w-[90vw] h-[90vh] max-w-[1400px] flex flex-col p-0">
				<DialogHeader className="px-6 pt-6 pb-4 border-b">
					<DialogTitle className="flex items-center gap-2 text-base">
						<Package className="size-4" /> Import Bundle
					</DialogTitle>
					{/* Summary stats */}
					<div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
						<span className="font-medium text-foreground">
							{stats.total} items
						</span>
						<span>·</span>
						<span>{stats.profiles} profiles</span>
						<span>·</span>
						<span>{stats.autoruns} autoruns</span>
						{stats.issues > 0 && (
							<>
								<span>·</span>
								<span className="text-amber-500">
									{stats.issues} issues
								</span>
							</>
						)}
						{stats.removed > 0 && (
							<>
								<span>·</span>
								<span className="text-destructive">
									{stats.removed} removed
								</span>
							</>
						)}
					</div>
				</DialogHeader>

				{/* Toolbar */}
				<div className="flex items-center gap-2 px-6 py-3 border-b bg-muted/30">
					<div className="relative flex-1 max-w-xs">
						<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
						<Input
							placeholder="Search items..."
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							className="h-7 pl-8 text-xs"
						/>
					</div>
					<Select
						value={filterStatus}
						onValueChange={(v) => setFilterStatus(v as FilterStatus)}
					>
						<SelectTrigger className="h-7 w-[130px] text-xs">
							<Filter className="size-3 mr-1.5" />
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All items</SelectItem>
							<SelectItem value="ready">Ready</SelectItem>
							<SelectItem value="issue">Needs resolution</SelectItem>
							<SelectItem value="removed">Removed</SelectItem>
						</SelectContent>
					</Select>
					<div className="flex items-center gap-1 ml-auto">
						<Button
							variant="ghost"
							size="sm"
							className="h-7 text-xs"
							onClick={handleSelectAll}
						>
							Select all
						</Button>
						<Button
							variant="ghost"
							size="sm"
							className="h-7 text-xs"
							onClick={handleDeselectAll}
						>
							Deselect
						</Button>
						<div className="w-px h-4 bg-border mx-1" />
						{selectedIds.size > 0 && (
							<>
								<Button
									variant="ghost"
									size="sm"
									className="h-7 text-xs text-destructive hover:text-destructive"
									onClick={handleRemoveSelected}
								>
									<Trash2 className="size-3 mr-1" />
									Remove ({selectedIds.size})
								</Button>
								<Button
									variant="ghost"
									size="sm"
									className="h-7 text-xs"
									onClick={handleReincludeSelected}
								>
									<UserCheck className="size-3 mr-1" />
									Re-include ({selectedIds.size})
								</Button>
							</>
						)}
					</div>
				</div>

				{/* Content */}
				<ScrollArea className="flex-1 min-h-0 px-6 py-4">
					{phase === "loading" ? (
						<div className="flex items-center justify-center py-10 gap-2 text-sm text-muted-foreground">
							<Spinner className="size-4" /> Validating bundle...
						</div>
					) : filteredItems.length === 0 ? (
						<div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
							No items match your filters
						</div>
					) : (
						<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
							{filteredItems.map((item) => (
								<ImportItemCard
									key={item.id}
									item={item}
									selected={selectedIds.has(item.id)}
									expanded={expandedIds.has(item.id)}
									pluginMap={pluginMap}
									onClick={handleItemClick}
									onToggleExpand={toggleExpand}
									onToggleRemove={() => {
										setItems((prev) =>
											prev.map((it) =>
												it.id === item.id
													? { ...it, removed: !it.removed }
													: it,
											),
										);
									}}
									onPluginChange={setPluginMapping}
								/>
							))}
						</div>
					)}
				</ScrollArea>

				{/* Footer */}
				<DialogFooter className="px-6 py-4 border-t">
					<Button
						variant="ghost"
						size="sm"
						className="h-7 text-xs"
						onClick={onClose}
					>
						Cancel
					</Button>
					{(phase === "confirm" || phase === "resolve") && (
						<Button
							size="sm"
							className="h-7 text-xs"
							onClick={handleImport}
							disabled={
								importing ||
								activeCount === 0 ||
								(phase === "resolve" && !allResolved)
							}
						>
							{importing && <Spinner className="size-3 mr-1" />}
							Import ({activeCount} items)
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

// ── Item Card ─────────────────────────────────────────────────

function ImportItemCard({
	item,
	selected,
	expanded,
	pluginMap,
	onClick,
	onToggleExpand,
	onToggleRemove,
	onPluginChange,
}: {
	item: BundleItem;
	selected: boolean;
	expanded: boolean;
	pluginMap: Record<string, { type: string; id: number }>;
	onClick: (id: string, e: React.MouseEvent) => void;
	onToggleExpand: (id: string) => void;
	onToggleRemove: () => void;
	onPluginChange: (hash: string, type: string, id: number) => void;
}) {
	const isProfile = item.type === "profile";
	const data = item.data;

	const statusConfig = item.removed
		? {
				color: "border-muted",
				bg: "bg-muted/30",
				Icon: Trash2,
				ic: "text-muted-foreground",
				label: "Removed",
			}
		: item.status === "ok"
			? {
					color: "border-emerald-500/30",
					bg: "bg-emerald-500/5",
					Icon: CheckCircle2,
					ic: "text-emerald-500",
					label: "Ready to import",
				}
			: item.status === "skip"
				? {
						color: "border-emerald-500/30",
						bg: "bg-emerald-500/5",
						Icon: Info,
						ic: "text-emerald-500",
						label: "Already exists — will be skipped",
					}
				: item.status === "rename"
					? {
							color: "border-blue-500/30",
							bg: "bg-blue-500/5",
							Icon: AlertTriangle,
							ic: "text-blue-500",
							label: "Will be renamed",
						}
					: {
							color: "border-amber-500/30",
							bg: "bg-amber-500/5",
							Icon: AlertTriangle,
							ic: "text-amber-500",
							label: "Needs resolution",
						};

	if (isProfile) {
		const engine = data.default_engine as PluginRef | undefined;
		const resolver = data.resolver as PluginRef | undefined;
		const resolverConfig = data.resolver_config as
			| Record<string, unknown>
			| undefined;
		const retryMode = (data.retry_mode as string) ?? "none";
		const retryConfig = data.retry_config as Record<string, unknown> | undefined;
		const contentHash = data.content_hash as string | undefined;

		return (
			<Collapsible open={expanded} onOpenChange={() => onToggleExpand(item.id)}>
				<div
					className={cn(
						"rounded-lg border transition-all",
						statusConfig.color,
						item.removed && "opacity-50",
						selected && !item.removed && "ring-2 ring-primary/50",
					)}
					onClick={(e) => onClick(item.id, e)}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							onClick(item.id, e as unknown as React.MouseEvent);
						}
					}}
					role="button"
					tabIndex={0}
				>
					<CollapsibleTrigger className="w-full">
						<div className={cn("px-4 py-3", statusConfig.bg)}>
							<div className="flex items-center gap-3">
								<ChevronRight
									className={cn(
										"size-4 shrink-0 transition-transform text-muted-foreground",
										expanded && "rotate-90",
									)}
								/>
								<div className="flex-1 min-w-0 text-left">
									<p
										className={cn(
											"text-sm font-medium truncate",
											item.removed && "line-through",
										)}
									>
										{(data.name as string) ?? "Untitled"}
									</p>
								</div>
								<div className="flex items-center gap-1.5 shrink-0">
									<statusConfig.Icon
										className={cn("size-3.5", statusConfig.ic)}
									/>
									<span className="text-xs text-muted-foreground">
										{statusConfig.label}
									</span>
								</div>
							</div>
							<div className="flex items-center gap-4 ml-7 mt-1.5">
								<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
									<Cpu className="size-3" />{" "}
									<span>{engine?.name ?? "?"}</span>
								</div>
								<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
									<Zap className="size-3" />{" "}
									<span>{resolver?.name ?? "?"}</span>
								</div>
								{retryMode !== "none" && (
									<span className="text-xs text-muted-foreground">
										Retry: {retryMode}
									</span>
								)}
							</div>
						</div>
					</CollapsibleTrigger>
					<CollapsibleContent>
						<div className="px-4 pb-4 pt-2 space-y-3 border-t">
							<div className="grid gap-3" style={PLUGIN_CELLS.style}>
								<div style={{ gridArea: AREAS.engine }}>
									<PluginCell icon={Cpu} label="Engine" plugin={engine} />
								</div>
								<div style={{ gridArea: AREAS.resolver }}>
									<PluginCell icon={Zap} label="Resolver" plugin={resolver} />
								</div>
							</div>
							{resolverConfig &&
								Object.keys(resolverConfig).length > 0 && (
									<ConfigPreview
										title="Resolver Config"
										config={resolverConfig}
									/>
								)}
							{retryMode !== "none" &&
								retryConfig &&
								Object.keys(retryConfig).length > 0 && (
									<ConfigPreview
										title={`Retry Config (${retryMode})`}
										config={retryConfig}
									/>
								)}
							{contentHash && (
								<p className="text-[10px] text-muted-foreground font-mono">
									Hash: {contentHash}
								</p>
							)}
							{item.issues.map((issue, i) => (
								<IssueRow
									key={`${issue.problem}-${issue.field ?? ""}-${issue.profile_name ?? ""}-${i}`}
									issue={issue}
									pluginMap={pluginMap}
									onChange={onPluginChange}
								/>
							))}
							<Button
								variant="ghost"
								size="sm"
								className="h-6 text-xs text-destructive hover:text-destructive"
								onClick={(e) => {
									e.stopPropagation();
									onToggleRemove();
								}}
							>
								<Trash2 className="size-3 mr-1" />
								{item.removed ? "Re-include" : "Remove"}
							</Button>
						</div>
					</CollapsibleContent>
				</div>
			</Collapsible>
		);
	}

	// Autorun card
	const profileName = data.profile_name as string | undefined;
	const recording = data.recording as boolean;
	const engineOverride = data.engine_override as PluginRef | undefined;
	const contentHash = data.content_hash as string | undefined;
	const startTime = data.start_time as string;
	const endTime = data.end_time as string;

	return (
		<Collapsible open={expanded} onOpenChange={() => onToggleExpand(item.id)}>
			<div
				className={cn(
					"rounded-lg border transition-all",
					statusConfig.color,
					item.removed && "opacity-50",
					selected && !item.removed && "ring-2 ring-primary/50",
				)}
				onClick={(e) => onClick(item.id, e)}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						onClick(item.id, e as unknown as React.MouseEvent);
					}
				}}
				role="button"
				tabIndex={0}
			>
				<CollapsibleTrigger className="w-full">
					<div
						className={cn(
							"flex items-center gap-3 px-4 py-3",
							statusConfig.bg,
						)}
					>
						<ChevronRight
							className={cn(
								"size-4 shrink-0 transition-transform text-muted-foreground",
								expanded && "rotate-90",
							)}
						/>
						<CalendarClock className="size-4 shrink-0 text-muted-foreground" />
						<div className="flex-1 min-w-0 text-left">
							<p
								className={cn(
									"text-sm font-medium truncate",
									item.removed && "line-through",
								)}
							>
								{(data.user_friendly_name as string) ?? "Untitled"}
							</p>
							<p className="text-xs text-muted-foreground truncate">
								Profile: {profileName ?? "?"} ·{" "}
								{recording ? "Recording" : "Stream only"}
							</p>
						</div>
						<div className="flex items-center gap-1.5 shrink-0">
							<statusConfig.Icon
								className={cn("size-3.5", statusConfig.ic)}
							/>
							<span className="text-xs text-muted-foreground">
								{statusConfig.label}
							</span>
						</div>
					</div>
				</CollapsibleTrigger>
				<CollapsibleContent>
					<div className="px-4 pb-4 pt-1 space-y-3 border-t">
						<div className="grid gap-3" style={TIME_RANGE.style}>
							<div className="space-y-1" style={{ gridArea: AREAS.start }}>
								<Label className="text-[10px] text-muted-foreground uppercase tracking-wider">
									Start
								</Label>
								<p className="text-xs">
									{startTime
										? new Date(startTime).toLocaleString(undefined, {
												hour12: false,
											})
										: "—"}
								</p>
							</div>
							<div className="space-y-1" style={{ gridArea: AREAS.end }}>
								<Label className="text-[10px] text-muted-foreground uppercase tracking-wider">
									End
								</Label>
								<p className="text-xs">
									{endTime
										? new Date(endTime).toLocaleString(undefined, {
												hour12: false,
											})
										: "—"}
								</p>
							</div>
						</div>
						{engineOverride && (
							<PluginCell
								icon={Cpu}
								label="Engine Override"
								plugin={engineOverride}
							/>
						)}
						{contentHash && (
							<p className="text-[10px] text-muted-foreground font-mono">
								Hash: {contentHash}
							</p>
						)}
						{item.issues.map((issue, i) => (
							<IssueRow
								key={`${issue.problem}-${issue.field ?? ""}-${issue.profile_name ?? ""}-${i}`}
								issue={issue}
								pluginMap={pluginMap}
								onChange={onPluginChange}
							/>
						))}
						<Button
							variant="ghost"
							size="sm"
							className="h-6 text-xs text-destructive hover:text-destructive"
							onClick={(e) => {
								e.stopPropagation();
								onToggleRemove();
							}}
						>
							<Trash2 className="size-3 mr-1" />
							{item.removed ? "Re-include" : "Remove"}
						</Button>
					</div>
				</CollapsibleContent>
			</div>
		</Collapsible>
	);
}

// ── Plugin Cell (hover-to-reveal hash, click-to-copy) ───────────

function PluginCell({
	icon: Icon,
	label,
	plugin,
}: {
	icon: React.ComponentType<{ className?: string }>;
	label: string;
	plugin: PluginRef | undefined;
}) {
	const [hovered, setHovered] = useState(false);
	const [copied, copy] = useCopyToClipboard();
	function handleClick() {
		if (!plugin?.origin_hash) return;
		copy(plugin.origin_hash);
	}
	return (
		// biome-ignore lint/a11y/useSemanticElements: complex layout with hover/copy UX
		<div
			className="flex items-center gap-2 rounded-md border px-2.5 py-2 bg-muted/10 hover:bg-muted/20 transition-colors cursor-pointer select-none"
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			onClick={handleClick}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					handleClick();
				}
			}}
			role="button"
			tabIndex={0}
			title={plugin?.origin_hash ? "Click to copy hash" : undefined}
		>
			<Icon className="size-3.5 text-muted-foreground shrink-0" />
			<div className="flex-1 min-w-0">
				<p className="text-[10px] text-muted-foreground uppercase tracking-wider">
					{label}
				</p>
				<div className="flex items-center gap-1">
					<p
						className={cn(
							"text-xs font-medium truncate transition-all duration-200",
							hovered ? "opacity-0 w-0" : "opacity-100",
						)}
					>
						{plugin?.name ?? "?"}
					</p>
					<p
						className={cn(
							"text-[10px] font-mono text-muted-foreground transition-all duration-200 flex items-center gap-1 min-w-0",
							hovered ? "opacity-100" : "opacity-0 w-0",
						)}
					>
						{copied ? (
							<>
								<Check className="size-3 shrink-0 text-emerald-500" /> Copied!
							</>
						) : (
							<>
								<span className="truncate">
									{plugin?.origin_hash?.slice(0, 16) ?? "?"}…
								</span>
								<Copy className="size-3 shrink-0 opacity-50" />
							</>
						)}
					</p>
				</div>
			</div>
		</div>
	);
}

// ── Config Preview (key-value table) ────────────────────────────

function ConfigPreview({
	title,
	config,
}: {
	title: string;
	config: Record<string, unknown>;
}) {
	const entries = Object.entries(config);
	if (entries.length === 0) return null;
	return (
		<div className="space-y-1">
			<Label className="text-[10px] text-muted-foreground uppercase tracking-wider">
				{title}
			</Label>
			<div className="rounded border bg-muted/20 overflow-hidden divide-y divide-border/50">
				{entries.map(([key, value]) => (
					<div key={key} className="flex items-center gap-3 py-1.5 px-3">
						<code className="font-mono font-semibold text-foreground text-xs shrink-0">
							{key}
						</code>
						<ConfigValue
							value={
								typeof value === "string" ? value : JSON.stringify(value)
							}
						/>
					</div>
				))}
			</div>
		</div>
	);
}

function ConfigValue({ value }: { value: string }) {
	const [hovered, setHovered] = useState(false);
	const [copied, copy] = useCopyToClipboard();
	const needsTruncate = value.length > 40;
	function handleClick() {
		copy(value);
	}
	if (!needsTruncate) {
		return (
			<code className="text-xs font-mono text-muted-foreground text-right flex-1 min-w-0">
				{value}
			</code>
		);
	}
	return (
		// biome-ignore lint/a11y/useSemanticElements: complex layout with hover/copy UX
		<div
			className="flex-1 min-w-0 flex items-center justify-end gap-1 cursor-pointer select-none"
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			onClick={handleClick}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					handleClick();
				}
			}}
			role="button"
			tabIndex={0}
			title="Click to copy"
		>
			<code
				className={cn(
					"text-xs font-mono text-muted-foreground truncate min-w-0 text-right transition-all duration-200",
					hovered && "text-foreground",
				)}
			>
				{copied ? "Copied!" : value}
			</code>
			<span
				className={cn(
					"shrink-0 transition-all duration-200",
					hovered ? "opacity-100" : "opacity-0",
				)}
			>
				{copied ? (
					<Check className="size-3 text-emerald-500" />
				) : (
					<Copy className="size-3 text-muted-foreground opacity-50" />
				)}
			</span>
		</div>
	);
}

// ── Issue Row ───────────────────────────────────────────────────

function IssueRow({
	issue,
	pluginMap,
	onChange,
}: {
	issue: Issue;
	pluginMap: Record<string, { type: string; id: number }>;
	onChange: (hash: string, type: string, id: number) => void;
}) {
	if (issue.problem === "already_exists") {
		return (
			<div className="flex items-center gap-2 rounded border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
				<CheckCircle2 className="size-3.5 shrink-0" />
				<span>Identical content already exists — will be skipped.</span>
			</div>
		);
	}
	if (issue.problem === "name_conflict") {
		return (
			<div className="flex items-center gap-2 rounded border border-blue-500/30 bg-blue-500/5 px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
				<AlertTriangle className="size-3.5 shrink-0" />
				<span>
					Name conflict — will be imported as:{" "}
					<strong>{issue.new_name ?? `${issue.bundled?.name}_2`}</strong>
				</span>
			</div>
		);
	}
	if (issue.problem === "profile_missing") {
		return (
			<div className="flex items-center gap-2 rounded border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-300">
				<AlertTriangle className="size-3.5 shrink-0" />
				<span>
					References profile <strong>{issue.profile_name}</strong> which is not
					available.
				</span>
			</div>
		);
	}
	if (!issue.bundled) return null;
	const currentHash = issue.bundled.origin_hash;
	const currentSelection = pluginMap[currentHash];
	return (
		<div className="rounded border px-3 py-2.5 space-y-2">
			<div className="flex items-center justify-between">
				<span className="text-xs font-medium">{issue.bundled.name}</span>
				<span className="text-[10px] text-muted-foreground font-mono truncate max-w-[120px]">
					{currentHash}
				</span>
			</div>
			<p className="text-xs text-muted-foreground">
				{issue.problem === "not_installed"
					? "Not installed"
					: "Hash mismatch — plugin was updated"}
			</p>
			{issue.alternatives && issue.alternatives.length > 0 && (
				<div className="space-y-1">
					<Label className="text-[10px]">Map to:</Label>
					<Select
						value={currentSelection ? String(currentSelection.id) : ""}
						onValueChange={(v: string) =>
							onChange(currentHash, issue.field ?? "", parseInt(v, 10))
						}
					>
						<SelectTrigger className="h-7 text-xs">
							<SelectValue placeholder="Select plugin" />
						</SelectTrigger>
						<SelectContent>
							{issue.alternatives.map((alt) => (
								<SelectItem key={alt.id} value={String(alt.id)}>
									{alt.name}{" "}
									<span className="text-[10px] text-muted-foreground ml-1">
										{alt.origin_hash.slice(0, 8)}…
									</span>
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			)}
			{issue.alternatives && issue.alternatives.length === 0 && (
				<p className="text-xs text-destructive">
					No plugins available to resolve this.
				</p>
			)}
		</div>
	);
}
