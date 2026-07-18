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
	Package,
	Search,
	Trash2,
	UserCheck,
	Zap,
} from "lucide-react";
import {
	type ComponentType,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
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
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { importExportApi } from "@/lib/api";
import { AREAS, PLUGIN_CELLS, TIME_RANGE } from "@/lib/layouts";
import type { ValidationReport } from "@/lib/schemas";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────

type PluginRef = { name: string; origin_hash: string };

type Issue = ValidationReport["profiles"][number]["issues"][number];

type Phase = "loading" | "confirm" | "resolve";
type FilterStatus = "ready" | "issue" | "removed";

type BundleItem = {
	id: string;
	type: "profile" | "autorun";
	data: Record<string, unknown>;
	status: "ok" | "skip" | "rename" | "issue";
	issues: Issue[];
	removed: boolean;
};

type PluginMap = Record<string, { type: string; id: number }>;

// ── Helpers ───────────────────────────────────────────────────

function statusBadgeVariant(
	item: BundleItem,
): "secondary" | "outline" | "destructive" | "default" {
	if (item.removed) return "destructive";
	if (item.status === "ok" || item.status === "skip") return "secondary";
	if (item.status === "rename") return "outline";
	return "default";
}

function statusLabel(item: BundleItem): string {
	if (item.removed) return "Removed";
	if (item.status === "ok") return "Ready";
	if (item.status === "skip") return "Skipped";
	if (item.status === "rename") return "Rename";
	return "Issues";
}

function statusBorderColor(item: BundleItem): string {
	if (item.removed) return "border-muted";
	if (item.status === "ok" || item.status === "skip")
		return "border-emerald-500/30";
	if (item.status === "rename") return "border-blue-500/30";
	return "border-amber-500/30";
}

function buildInitialPluginMap(report: ValidationReport): PluginMap {
	const map: PluginMap = {};
	const allResults = [...report.profiles, ...report.autoruns];
	for (const result of allResults) {
		for (const issue of result.issues) {
			if (issue.bundled && issue.alternatives?.length) {
				const best =
					issue.alternatives.find((a) => a.name === issue.bundled?.name) ??
					issue.alternatives[0];
				map[issue.bundled.origin_hash] = {
					type: issue.field ?? "",
					id: best.id,
				};
			}
		}
	}
	return map;
}

function buildBundleItems(
	bundle: Record<string, unknown>,
	report: ValidationReport,
): BundleItem[] {
	const rawProfiles = (bundle.profiles as Array<Record<string, unknown>>) ?? [];
	const rawAutoruns = (bundle.autoruns as Array<Record<string, unknown>>) ?? [];
	const items: BundleItem[] = [];

	for (let i = 0; i < rawProfiles.length; i++) {
		const p = rawProfiles[i];
		const issues = report.profiles[i]?.issues ?? [];
		const status =
			issues.length === 0
				? ("ok" as const)
				: issues.some((iss) => iss.problem === "already_exists")
					? ("skip" as const)
					: issues.some((iss) => iss.problem === "name_conflict")
						? ("rename" as const)
						: ("issue" as const);
		items.push({
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
		const issues = report.autoruns[i]?.issues ?? [];
		const status = issues.length === 0 ? ("ok" as const) : ("issue" as const);
		items.push({
			id: `autorun-${i}`,
			type: "autorun",
			data: a,
			status,
			issues,
			removed: false,
		});
	}

	return items;
}

function computeStats(items: BundleItem[]) {
	const total = items.length;
	const profiles = items.filter((i) => i.type === "profile").length;
	const autoruns = items.filter((i) => i.type === "autorun").length;
	const ready = items.filter((i) => i.status === "ok" && !i.removed).length;
	const issues = items.filter(
		(i) => (i.status === "issue" || i.status === "rename") && !i.removed,
	).length;
	const removed = items.filter((i) => i.removed).length;
	return { total, profiles, autoruns, ready, issues, removed };
}

function isAllResolved(items: BundleItem[], pluginMap: PluginMap): boolean {
	for (const item of items) {
		if (
			item.removed ||
			item.status === "ok" ||
			item.status === "skip" ||
			item.status === "rename"
		)
			continue;
		for (const issue of item.issues) {
			if (
				issue.problem === "name_conflict" ||
				issue.problem === "already_exists"
			)
				continue;
			if (issue.bundled && !pluginMap[issue.bundled.origin_hash]) return false;
		}
	}
	return true;
}

function filterItems(
	items: BundleItem[],
	search: string,
	activeFilters: Set<FilterStatus>,
): BundleItem[] {
	return items.filter((item) => {
		if (search) {
			const q = search.toLowerCase();
			const name =
				(item.data.name as string) ??
				(item.data.user_friendly_name as string) ??
				"";
			const engineName = (item.data.default_engine as PluginRef)?.name ?? "";
			const resolverName = (item.data.resolver as PluginRef)?.name ?? "";
			const profileName = (item.data.profile_name as string) ?? "";
			if (
				!name.toLowerCase().includes(q) &&
				!engineName.toLowerCase().includes(q) &&
				!resolverName.toLowerCase().includes(q) &&
				!profileName.toLowerCase().includes(q)
			) {
				return false;
			}
		}
		if (activeFilters.size === 0) return true;
		const matchesReady =
			activeFilters.has("ready") &&
			(item.status === "ok" || item.status === "skip") &&
			!item.removed;
		const matchesIssue =
			activeFilters.has("issue") &&
			(item.status === "issue" || item.status === "rename") &&
			!item.removed;
		const matchesRemoved = activeFilters.has("removed") && item.removed;
		return matchesReady || matchesIssue || matchesRemoved;
	});
}

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

	// Core state
	const [phase, setPhase] = useState<Phase>("loading");
	const [items, setItems] = useState<BundleItem[]>([]);
	const [pluginMap, setPluginMap] = useState<PluginMap>({});
	const [importing, setImporting] = useState(false);

	// UI state
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [search, setSearch] = useState("");
	const [activeFilters, setActiveFilters] = useState<Set<FilterStatus>>(
		new Set(),
	);
	const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
	const lastClickedId = useRef<string | null>(null);

	const onCloseRef = useRef(onClose);
	useEffect(() => {
		onCloseRef.current = onClose;
	}, [onClose]);

	// Reset + validate when dialog opens
	const resetState = useCallback(() => {
		setPhase("loading");
		setItems([]);
		setPluginMap({});
		setSelectedIds(new Set());
		setSearch("");
		setActiveFilters(new Set());
		setExpandedIds(new Set());
		lastClickedId.current = null;
	}, []);

	useEffect(() => {
		if (!open || !bundle) return;
		resetState();

		importExportApi
			.validate(bundle)
			.then((data) => {
				const r = data as ValidationReport;
				setPluginMap(buildInitialPluginMap(r));
				setItems(buildBundleItems(bundle, r));
				setPhase(r.valid ? "confirm" : "resolve");
			})
			.catch((err) => {
				toast.error(`Validation failed: ${err.message}`);
				onCloseRef.current();
			});
	}, [open, bundle, resetState]);

	// Derived state
	const filteredItems = useMemo(
		() => filterItems(items, search, activeFilters),
		[items, search, activeFilters],
	);
	const stats = useMemo(() => computeStats(items), [items]);
	const allResolved = useMemo(
		() => isAllResolved(items, pluginMap),
		[items, pluginMap],
	);
	const activeCount = useMemo(
		() => items.filter((i) => !i.removed).length,
		[items],
	);

	// ── Selection ────────────────────────────────────────

	const toggleExpand = useCallback((id: string) => {
		setExpandedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);

	const handleItemClick = useCallback(
		(id: string, e: React.MouseEvent) => {
			const item = items.find((i) => i.id === id);
			if (!item) return;

			// Ctrl/Cmd+click → toggle selection
			if (e.ctrlKey || e.metaKey) {
				setSelectedIds((prev) => {
					const next = new Set(prev);
					if (next.has(id)) next.delete(id);
					else next.add(id);
					return next;
				});
				lastClickedId.current = id;
				return;
			}

			// Shift+click → range selection
			if (e.shiftKey && lastClickedId.current !== null) {
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
				lastClickedId.current = id;
				return;
			}

			// Plain click → toggle expand
			toggleExpand(id);
			lastClickedId.current = id;
		},
		[items, filteredItems, toggleExpand],
	);

	// ── Batch actions ────────────────────────────────────

	const handleSelectAll = useCallback(() => {
		setSelectedIds(
			new Set(filteredItems.filter((i) => !i.removed).map((i) => i.id)),
		);
	}, [filteredItems]);

	const handleDeselectAll = useCallback(() => {
		setSelectedIds(new Set());
	}, []);

	const handleRemoveSelected = useCallback(() => {
		const visibleIds = new Set(filteredItems.map((i) => i.id));
		setItems((prev) =>
			prev.map((item) =>
				selectedIds.has(item.id) && visibleIds.has(item.id)
					? { ...item, removed: true }
					: item,
			),
		);
		setSelectedIds(new Set());
	}, [selectedIds, filteredItems]);

	const handleReincludeSelected = useCallback(() => {
		const visibleIds = new Set(filteredItems.map((i) => i.id));
		setItems((prev) =>
			prev.map((item) =>
				selectedIds.has(item.id) && visibleIds.has(item.id)
					? { ...item, removed: false }
					: item,
			),
		);
		setSelectedIds(new Set());
	}, [selectedIds, filteredItems]);

	const toggleItemRemove = useCallback((id: string) => {
		setItems((prev) =>
			prev.map((it) => (it.id === id ? { ...it, removed: !it.removed } : it)),
		);
	}, []);

	const setPluginMapping = useCallback(
		(hash: string, type: string, id: number) => {
			setPluginMap((prev) => ({ ...prev, [hash]: { type, id } }));
		},
		[],
	);

	// ── Import ───────────────────────────────────────────

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
			toast.error(err instanceof Error ? err.message : "Import failed");
		} finally {
			setImporting(false);
		}
	}, [bundle, pluginMap, items, queryClient, onImported, onClose]);

	// ── Render ───────────────────────────────────────────

	return (
		<Dialog open={open} onOpenChange={(v) => !v && onClose()}>
			<DialogContent
				className="w-[90vw] h-[90vh] max-w-[1400px] sm:max-w-[1400px] flex flex-col p-0 gap-0 overflow-hidden"
				showCloseButton={false}
			>
				{/* Header */}
				<div className="px-6 pt-6 pb-4 border-b shrink-0">
					<DialogTitle className="flex items-center gap-2 text-base">
						<Package className="size-4" /> Import Bundle
					</DialogTitle>
					<SummaryBar stats={stats} />
				</div>

				{/* Toolbar */}
				<div className="flex items-center gap-2 px-6 py-3 border-b bg-muted/30 shrink-0">
					<div className="relative flex-1 max-w-xs">
						<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
						<Input
							placeholder="Search items..."
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							className="h-7 pl-8 text-xs"
						/>
					</div>
					<div className="flex items-center gap-1">
						<Filter className="size-3 text-muted-foreground mr-1" />
						{(
							[
								["ready", `Ready${stats.ready > 0 ? ` (${stats.ready})` : ""}`],
								[
									"issue",
									`Issues${stats.issues > 0 ? ` (${stats.issues})` : ""}`,
								],
								[
									"removed",
									`Removed${stats.removed > 0 ? ` (${stats.removed})` : ""}`,
								],
							] as const
						).map(([key, label]) => (
							<button
								key={key}
								type="button"
								className={cn(
									"h-6 px-2 text-xs rounded-md border transition-colors",
									activeFilters.has(key)
										? "bg-foreground text-background border-foreground"
										: "bg-transparent text-muted-foreground border-border hover:bg-muted/50",
								)}
								onClick={() => {
									setActiveFilters((prev) => {
										const next = new Set(prev);
										if (next.has(key)) next.delete(key);
										else next.add(key);
										return next;
									});
								}}
							>
								{label}
							</button>
						))}
					</div>
					<div className="flex items-center gap-1 ml-auto">
						{selectedIds.size > 0 ? (
							<Button
								variant="ghost"
								size="sm"
								className="h-7 text-xs"
								onClick={handleDeselectAll}
							>
								Deselect ({selectedIds.size})
							</Button>
						) : (
							<Button
								variant="ghost"
								size="sm"
								className="h-7 text-xs"
								onClick={handleSelectAll}
							>
								Select all
							</Button>
						)}
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
				<ScrollArea className="flex-1 min-h-0">
					<div className="px-6 py-4">
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
										onToggleRemove={toggleItemRemove}
										onPluginChange={setPluginMapping}
									/>
								))}
							</div>
						)}
					</div>
				</ScrollArea>

				{/* Footer — custom styled to avoid base class bleed */}
				<div className="flex items-center justify-end gap-2 px-6 py-4 border-t shrink-0">
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
							Import ({activeCount} {activeCount === 1 ? "item" : "items"})
						</Button>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}

// ── Summary Bar ──────────────────────────────────────────────

function SummaryBar({ stats }: { stats: ReturnType<typeof computeStats> }) {
	const importable = stats.total - stats.removed;
	return (
		<div className="flex items-center gap-4 mt-2">
			<div className="flex items-center gap-2 text-xs text-muted-foreground">
				<span className="font-medium text-foreground">
					{stats.total} {stats.total === 1 ? "item" : "items"}
				</span>
				{importable > 0 && (
					<div className="flex items-center gap-1.5">
						<div className="flex h-1.5 w-20 rounded-full overflow-hidden bg-muted">
							<div
								className="bg-blue-500 transition-all"
								style={{
									width: `${(stats.profiles / importable) * 100}%`,
								}}
							/>
							<div
								className="bg-amber-500 transition-all"
								style={{
									width: `${(stats.autoruns / importable) * 100}%`,
								}}
							/>
						</div>
						<span className="text-[10px]">
							{stats.profiles}p · {stats.autoruns}a
						</span>
					</div>
				)}
				{stats.removed > 0 && (
					<span className="text-destructive">· {stats.removed} removed</span>
				)}
			</div>
		</div>
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
	pluginMap: PluginMap;
	onClick: (id: string, e: React.MouseEvent) => void;
	onToggleExpand: (id: string) => void;
	onToggleRemove: (id: string) => void;
	onPluginChange: (hash: string, type: string, id: number) => void;
}) {
	const borderColor = statusBorderColor(item);
	const badgeVariant = statusBadgeVariant(item);
	const badgeLabel = statusLabel(item);
	const isProfile = item.type === "profile";

	const headerBgClass = item.removed
		? "bg-muted/30"
		: item.status === "ok" || item.status === "skip"
			? "bg-emerald-500/5"
			: item.status === "rename"
				? "bg-blue-500/5"
				: "bg-amber-500/5";

	return (
		<Collapsible open={expanded} onOpenChange={() => onToggleExpand(item.id)}>
			{/* biome-ignore lint/a11y/useSemanticElements: card needs div for click+select+expand interaction */}
			<div
				className={cn(
					"rounded-lg border transition-all select-none cursor-pointer",
					"hover:border-foreground/20 hover:shadow-sm",
					borderColor,
					item.removed && "opacity-50",
					selected && !item.removed && "ring-2 ring-primary/50",
				)}
				onClick={(e) => onClick(item.id, e)}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						onToggleExpand(item.id);
					}
				}}
				role="button"
				tabIndex={0}
			>
				{/* Header */}
				<div className={cn("px-4 py-3", headerBgClass)}>
					{isProfile ? (
						<ProfileHeader
							item={item}
							expanded={expanded}
							badgeVariant={badgeVariant}
							badgeLabel={badgeLabel}
							onToggleExpand={onToggleExpand}
						/>
					) : (
						<AutorunHeader
							item={item}
							expanded={expanded}
							badgeVariant={badgeVariant}
							badgeLabel={badgeLabel}
							onToggleExpand={onToggleExpand}
						/>
					)}
				</div>

				{/* Expanded content */}
				<CollapsibleContent>
					{/* biome-ignore lint/a11y/noStaticElementInteractions: stops event bubbling to card wrapper */}
					{/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation only, no click behavior */}
					<div
						className="px-4 pb-4 pt-2 space-y-3 border-t"
						onClick={(e) => e.stopPropagation()}
					>
						{isProfile ? (
							<ProfileExpanded
								data={item.data}
								issues={item.issues}
								pluginMap={pluginMap}
								onPluginChange={onPluginChange}
							/>
						) : (
							<AutorunExpanded
								data={item.data}
								issues={item.issues}
								pluginMap={pluginMap}
								onPluginChange={onPluginChange}
							/>
						)}
						<Button
							variant="ghost"
							size="sm"
							className="h-6 text-xs text-destructive hover:text-destructive"
							onClick={() => onToggleRemove(item.id)}
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

// ── Profile Header ───────────────────────────────────────────

function ProfileHeader({
	item,
	expanded,
	badgeVariant,
	badgeLabel,
	onToggleExpand,
}: {
	item: BundleItem;
	expanded: boolean;
	badgeVariant: "secondary" | "outline" | "destructive" | "default";
	badgeLabel: string;
	onToggleExpand: (id: string) => void;
}) {
	const data = item.data;
	const engine = data.default_engine as PluginRef | undefined;
	const resolver = data.resolver as PluginRef | undefined;
	const retryMode = (data.retry_mode as string) ?? "none";

	return (
		<>
			<div className="flex items-center gap-3">
				<button
					type="button"
					tabIndex={-1}
					className="shrink-0 p-0.5 rounded hover:bg-muted/50 transition-colors"
					onMouseDown={(e) => e.preventDefault()}
					onClick={(e) => {
						e.stopPropagation();
						onToggleExpand(item.id);
					}}
					aria-label={expanded ? "Collapse" : "Expand"}
				>
					<ChevronRight
						className={cn(
							"size-4 transition-transform text-muted-foreground",
							expanded && "rotate-90",
						)}
					/>
				</button>
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
				<Badge variant={badgeVariant} className="text-[10px] shrink-0">
					{badgeLabel}
				</Badge>
			</div>
			<div className="flex items-center gap-x-4 gap-y-1 ml-7 mt-1.5 flex-wrap">
				<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
					<Cpu className="size-3" /> <span>{engine?.name ?? "?"}</span>
				</div>
				<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
					<Zap className="size-3" /> <span>{resolver?.name ?? "?"}</span>
				</div>
				{retryMode !== "none" && (
					<span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
						Retry: {retryMode}
					</span>
				)}
			</div>
		</>
	);
}

// ── Autorun Header ───────────────────────────────────────────

function AutorunHeader({
	item,
	expanded,
	badgeVariant,
	badgeLabel,
	onToggleExpand,
}: {
	item: BundleItem;
	expanded: boolean;
	badgeVariant: "secondary" | "outline" | "destructive" | "default";
	badgeLabel: string;
	onToggleExpand: (id: string) => void;
}) {
	const data = item.data;
	const profileName = data.profile_name as string | undefined;
	const recording = data.recording as boolean;

	return (
		<div className="flex items-center gap-3">
			<button
				type="button"
				tabIndex={-1}
				className="shrink-0 p-0.5 rounded hover:bg-muted/50 transition-colors"
				onMouseDown={(e) => e.preventDefault()}
				onClick={(e) => {
					e.stopPropagation();
					onToggleExpand(item.id);
				}}
				aria-label={expanded ? "Collapse" : "Expand"}
			>
				<ChevronRight
					className={cn(
						"size-4 transition-transform text-muted-foreground",
						expanded && "rotate-90",
					)}
				/>
			</button>
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
			<Badge variant={badgeVariant} className="text-[10px] shrink-0">
				{badgeLabel}
			</Badge>
		</div>
	);
}

// ── Profile Expanded Content ─────────────────────────────────

function ProfileExpanded({
	data,
	issues,
	pluginMap,
	onPluginChange,
}: {
	data: Record<string, unknown>;
	issues: Issue[];
	pluginMap: PluginMap;
	onPluginChange: (hash: string, type: string, id: number) => void;
}) {
	const engine = data.default_engine as PluginRef | undefined;
	const resolver = data.resolver as PluginRef | undefined;
	const resolverConfig = data.resolver_config as
		| Record<string, unknown>
		| undefined;
	const retryMode = (data.retry_mode as string) ?? "none";
	const retryConfig = data.retry_config as Record<string, unknown> | undefined;
	const contentHash = data.content_hash as string | undefined;

	return (
		<>
			<div className="grid gap-3 w-full" style={PLUGIN_CELLS.style}>
				<div style={{ gridArea: AREAS.engine }}>
					<PluginCell icon={Cpu} label="Engine" plugin={engine} />
				</div>
				<div style={{ gridArea: AREAS.resolver }}>
					<PluginCell icon={Zap} label="Resolver" plugin={resolver} />
				</div>
			</div>
			{retryMode !== "none" && (
				<p className="text-xs text-muted-foreground">
					Retry: <span className="font-mono">{retryMode}</span>
				</p>
			)}
			{resolverConfig && Object.keys(resolverConfig).length > 0 && (
				<ConfigPreview title="Resolver config" config={resolverConfig} />
			)}
			{retryMode !== "none" &&
				retryConfig &&
				Object.keys(retryConfig).length > 0 && (
					<ConfigPreview title="Retry config" config={retryConfig} />
				)}
			{contentHash && (
				<p
					className="text-[10px] text-muted-foreground/60 font-mono truncate"
					title={contentHash}
				>
					{contentHash}
				</p>
			)}
			<IssueList
				issues={issues}
				pluginMap={pluginMap}
				onChange={onPluginChange}
			/>
		</>
	);
}

// ── Autorun Expanded Content ─────────────────────────────────

function AutorunExpanded({
	data,
	issues,
	pluginMap,
	onPluginChange,
}: {
	data: Record<string, unknown>;
	issues: Issue[];
	pluginMap: PluginMap;
	onPluginChange: (hash: string, type: string, id: number) => void;
}) {
	const [, copyHash] = useCopyToClipboard();
	const engineOverride = data.engine_override as PluginRef | undefined;
	const contentHash = data.content_hash as string | undefined;
	const startTime = data.start_time as string;
	const endTime = data.end_time as string;

	return (
		<>
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
				<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
					<Cpu className="size-3 shrink-0" />
					<span className="font-medium text-foreground">
						{engineOverride.name}
					</span>
					{engineOverride.origin_hash && (
						<button
							type="button"
							tabIndex={-1}
							onMouseDown={(e) => e.preventDefault()}
							className="font-mono text-muted-foreground/60 hover:text-muted-foreground transition-colors cursor-pointer"
							onClick={() => copyHash(engineOverride.origin_hash)}
						>
							{engineOverride.origin_hash.slice(0, 8)}
						</button>
					)}
				</span>
			)}
			{contentHash && (
				<p
					className="text-[10px] text-muted-foreground/60 font-mono truncate"
					title={contentHash}
				>
					{contentHash}
				</p>
			)}
			<IssueList
				issues={issues}
				pluginMap={pluginMap}
				onChange={onPluginChange}
			/>
		</>
	);
}

// ── Issue List ───────────────────────────────────────────────

function IssueList({
	issues,
	pluginMap,
	onChange,
}: {
	issues: Issue[];
	pluginMap: PluginMap;
	onChange: (hash: string, type: string, id: number) => void;
}) {
	if (issues.length === 0) return null;
	return (
		<>
			{issues.map((issue, i) => (
				<IssueRow
					// biome-ignore lint/suspicious/noArrayIndexKey: issues can have duplicate problem+field combos
					key={`${issue.problem}-${issue.field ?? ""}-${issue.profile_name ?? ""}-${i}`}
					issue={issue}
					pluginMap={pluginMap}
					onChange={onChange}
				/>
			))}
		</>
	);
}

// ── Plugin Cell (hover-to-reveal hash, click-to-copy) ────────

function PluginCell({
	icon: Icon,
	label,
	plugin,
}: {
	icon: ComponentType<{ className?: string }>;
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
				<div className="relative h-4">
					<p
						className={cn(
							"absolute inset-0 flex items-center text-xs font-medium truncate transition-opacity duration-200",
							hovered ? "opacity-0" : "opacity-100",
						)}
					>
						{plugin?.name ?? "?"}
					</p>
					<p
						className={cn(
							"absolute inset-0 flex items-center gap-1 text-[10px] font-mono text-muted-foreground transition-opacity duration-200",
							hovered ? "opacity-100" : "opacity-0",
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

// ── Config Preview (key-value table) ─────────────────────────

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
							value={typeof value === "string" ? value : JSON.stringify(value)}
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
			onClick={() => copy(value)}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					copy(value);
				}
			}}
			role="button"
			tabIndex={0}
			title="Click to copy"
		>
			<code
				className={cn(
					"text-xs font-mono text-muted-foreground truncate min-w-0 text-right transition-colors duration-200",
					hovered && "text-foreground",
				)}
			>
				{copied ? "Copied!" : value}
			</code>
			<span className="size-3 shrink-0">
				{copied ? (
					<Check className="size-3 text-emerald-500" />
				) : (
					<span
						className={cn(
							"transition-opacity duration-200",
							hovered ? "opacity-100" : "opacity-0",
						)}
					>
						<Copy className="size-3 text-muted-foreground opacity-50" />
					</span>
				)}
			</span>
		</div>
	);
}

// ── Issue Row ────────────────────────────────────────────────

function IssueRow({
	issue,
	pluginMap,
	onChange,
}: {
	issue: Issue;
	pluginMap: PluginMap;
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
	const issueAlternatives = (issue.alternatives ?? []).map((alt) => ({
		value: String(alt.id),
		label: `${alt.name} · ${alt.origin_hash.slice(0, 8)}`,
	}));

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
						items={issueAlternatives}
						value={currentSelection ? String(currentSelection.id) : ""}
						onValueChange={(v: string) =>
							onChange(currentHash, issue.field ?? "", parseInt(v, 10))
						}
					>
						<SelectTrigger className="h-7 text-xs w-full">
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
