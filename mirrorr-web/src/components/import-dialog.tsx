import { useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	Check,
	CheckCircle2,
	ChevronRight,
	Copy,
	Cpu,
	Filter,
	Package,
	Search,
	Timer,
	Trash2,
	User,
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
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useIsMobile } from "@/hooks/use-mobile";
import {
	type ColumnDef,
	useResizableColumns,
} from "@/hooks/use-resizable-columns";
import { importExportApi } from "@/lib/api";
import { AREAS, AUTORUN_EXPANDED, PROFILE_EXPANDED } from "@/lib/layouts";
import type { ValidationReport } from "@/lib/schemas";
import { cn, parseUtcDate } from "@/lib/utils";
import type { BundleFile } from "@/components/import-export-buttons";

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
	sourceFile: string;
};

type PluginMap = Record<string, { type: string; id: number }>;

// ── Helpers ───────────────────────────────────────────────────

function statusLabel(item: BundleItem): string {
	if (item.removed) return "Removed";
	if (item.status === "ok") return "Ready";
	if (item.status === "skip") return "Skipped";
	if (item.status === "rename") return "Rename";
	return "Issues";
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
	bundles: BundleFile[],
	reports: ValidationReport[],
): BundleItem[] {
	const items: BundleItem[] = [];
	let profileIdx = 0;
	let autorunIdx = 0;

	bundles.forEach(({ bundle, filename }, k) => {
		const report = reports[k];
		const rawProfiles =
			(bundle.profiles as Array<Record<string, unknown>>) ?? [];
		const rawAutoruns =
			(bundle.autoruns as Array<Record<string, unknown>>) ?? [];

		for (let i = 0; i < rawProfiles.length; i++) {
			const p = rawProfiles[i];
			const issues = report?.profiles[i]?.issues ?? [];
			const status =
				issues.length === 0
					? ("ok" as const)
					: issues.some((iss) => iss.problem === "already_exists")
						? ("skip" as const)
						: issues.some((iss) => iss.problem === "name_conflict")
							? ("rename" as const)
							: ("issue" as const);
			items.push({
				id: `profile-${profileIdx++}`,
				type: "profile",
				data: p,
				status,
				issues,
				removed: false,
				sourceFile: filename,
			});
		}

		for (let i = 0; i < rawAutoruns.length; i++) {
			const a = rawAutoruns[i];
			const issues = report?.autoruns[i]?.issues ?? [];
			const status = issues.length === 0 ? ("ok" as const) : ("issue" as const);
			items.push({
				id: `autorun-${autorunIdx++}`,
				type: "autorun",
				data: a,
				status,
				issues,
				removed: false,
				sourceFile: filename,
			});
		}
	});

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
	fileFilter: string | null,
): BundleItem[] {
	return items.filter((item) => {
		if (fileFilter && item.sourceFile !== fileFilter) return false;
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

// ── Date / duration formatting ────────────────────────────────

/** "Monday 17, March 2026 at 13:43" — naive input treated as UTC, shown local */
function formatFullTimestamp(iso: string | undefined): string {
	if (!iso) return "—";
	const d = parseUtcDate(iso);
	if (!d || Number.isNaN(d.getTime())) return "—";
	const weekday = d.toLocaleDateString(undefined, { weekday: "long" });
	const day = d.getDate();
	const month = d.toLocaleDateString(undefined, { month: "long" });
	const year = d.getFullYear();
	const time = d.toLocaleTimeString(undefined, {
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
	return `${weekday} ${day}, ${month} ${year} at ${time}`;
}

/** Compact "07/18 18:00" for table cells — naive input treated as UTC, shown local */
function formatShortTimestamp(iso: string | undefined): string {
	if (!iso) return "—";
	const d = parseUtcDate(iso);
	if (!d || Number.isNaN(d.getTime())) return "—";
	const mm = String(d.getMonth() + 1).padStart(2, "0");
	const dd = String(d.getDate()).padStart(2, "0");
	const hh = String(d.getHours()).padStart(2, "0");
	const min = String(d.getMinutes()).padStart(2, "0");
	return `${mm}/${dd} ${hh}:${min}`;
}

/** Human duration "2h 14m" / "3d 5h" / "12m" */
function formatDuration(ms: number): string {
	const totalMin = Math.max(0, Math.round(ms / 60000));
	const days = Math.floor(totalMin / 1440);
	const hours = Math.floor((totalMin % 1440) / 60);
	const mins = totalMin % 60;
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${mins}m`;
	return `${mins}m`;
}

/** Live-updating ETA label for an autorun window. */
function LiveEta({ start, end }: { start?: string; end?: string }) {
	const [, setTick] = useState(0);
	useEffect(() => {
		const id = setInterval(() => setTick((t) => t + 1), 30000);
		return () => clearInterval(id);
	}, []);

	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), 30000);
		return () => clearInterval(id);
	}, []);

	const startMs = start ? (parseUtcDate(start)?.getTime() ?? Number.NaN) : Number.NaN;
	const endMs = end ? (parseUtcDate(end)?.getTime() ?? Number.NaN) : Number.NaN;

	let label: string;
	if (!Number.isNaN(startMs) && now < startMs) {
		label = `starts in ${formatDuration(startMs - now)}`;
	} else if (!Number.isNaN(endMs) && now < endMs) {
		label = `ends in ${formatDuration(endMs - now)}`;
	} else if (!Number.isNaN(endMs)) {
		label = "ended";
	} else {
		label = "—";
	}

	return (
		<span className="inline-flex items-center gap-1 text-micro font-medium text-blue-500">
			<Timer className="size-3" />
			{label}
		</span>
	);
}

// ── Main Dialog ───────────────────────────────────────────────

export function ImportDialog({
	open,
	onClose,
	onImported,
	bundles,
}: {
	open: boolean;
	onClose: () => void;
	onImported: () => void;
	bundles: BundleFile[] | null;
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
	const [fileFilter, setFileFilter] = useState<string | null>(null);
	const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
	const [confirmOpen, setConfirmOpen] = useState(false);
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
		setFileFilter(null);
		setExpandedIds(new Set());
		setConfirmOpen(false);
		lastClickedId.current = null;
	}, []);

	useEffect(() => {
		if (!open || !bundles || bundles.length === 0) return;

		Promise.all(bundles.map((b) => importExportApi.validate(b.bundle)))
			.then((reports) => {
				const rs = reports as ValidationReport[];
				// Reset state after the async validation resolves (not synchronously
				// in the effect) to avoid cascading renders.
				resetState();
				const merged: PluginMap = {};
				for (const r of rs) Object.assign(merged, buildInitialPluginMap(r));
				setPluginMap(merged);
				setItems(buildBundleItems(bundles, rs));
				setPhase(rs.every((r) => r.valid) ? "confirm" : "resolve");
			})
			.catch((err) => {
				toast.error(`Validation failed: ${err.message}`);
				onCloseRef.current();
			});
	}, [open, bundles, resetState]);

	// Derived state
	const filteredItems = useMemo(
		() => filterItems(items, search, activeFilters, fileFilter),
		[items, search, activeFilters, fileFilter],
	);
	const filteredProfiles = useMemo(
		() => filteredItems.filter((i) => i.type === "profile"),
		[filteredItems],
	);
	const filteredAutoruns = useMemo(
		() => filteredItems.filter((i) => i.type === "autorun"),
		[filteredItems],
	);
	const stats = useMemo(() => computeStats(items), [items]);
	const sourceFiles = useMemo(
		() => [...new Set(items.map((i) => i.sourceFile))],
		[items],
	);
	const showFile = sourceFiles.length > 1;
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

	// Count of selected items that aren't already removed (i.e. removable)
	const removableSelectedCount = useMemo(
		() => items.filter((i) => selectedIds.has(i.id) && !i.removed).length,
		[items, selectedIds],
	);
	// Count of selected items that are removed (i.e. re-includable)
	const reincludableSelectedCount = useMemo(
		() => items.filter((i) => selectedIds.has(i.id) && i.removed).length,
		[items, selectedIds],
	);

	// Request removal: confirm when removing 2+ items
	const requestRemoveSelected = useCallback(() => {
		if (removableSelectedCount >= 2) {
			setConfirmOpen(true);
		} else {
			handleRemoveSelected();
		}
	}, [removableSelectedCount, handleRemoveSelected]);

	// Delete-key shortcut for bulk remove
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Delete") return;
			const target = e.target as HTMLElement | null;
			if (
				target &&
				(target.tagName === "INPUT" ||
					target.tagName === "TEXTAREA" ||
					target.isContentEditable)
			) {
				return;
			}
			if (selectedIds.size === 0) return;
			e.preventDefault();
			requestRemoveSelected();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, selectedIds, requestRemoveSelected]);

	const toggleItemRemove = useCallback((id: string) => {
		setItems((prev) =>
			prev.map((it) => (it.id === id ? { ...it, removed: !it.removed } : it)),
		);
	}, []);

	const toggleItemSelect = useCallback((id: string, checked: boolean) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (checked) next.add(id);
			else next.delete(id);
			return next;
		});
		lastClickedId.current = id;
	}, []);

	const setPluginMapping = useCallback(
		(hash: string, type: string, id: number) => {
			setPluginMap((prev) => ({ ...prev, [hash]: { type, id } }));
		},
		[],
	);

	// ── Import ───────────────────────────────────────────

	const handleImport = useCallback(async () => {
		if (!bundles || bundles.length === 0) return;
		setImporting(true);
		try {
			const removedProfiles = items
				.filter((i) => i.type === "profile" && i.removed)
				.map((i) => (i.data.name as string) ?? "untitled");
			const removedAutoruns = items
				.filter((i) => i.type === "autorun" && i.removed)
				.map((i) => (i.data.user_friendly_name as string) ?? "untitled");

			const mergedBundle = {
				profiles: items.filter((i) => i.type === "profile").map((i) => i.data),
				autoruns: items.filter((i) => i.type === "autorun").map((i) => i.data),
			};

			const result = await importExportApi.apply(
				mergedBundle,
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
			if (result.renamed && Object.keys(result.renamed).length) {
				const renames = Object.entries(result.renamed)
					.map(([oldName, newName]) => `${oldName} → ${newName}`)
					.join(", ");
				msgs.push(`Renamed: ${renames}`);
			}
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
	}, [bundles, pluginMap, items, queryClient, onImported, onClose]);

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
					<SummaryBar stats={stats} fileCount={sourceFiles.length} />
				</div>

				{/* Toolbar */}
				<div className="flex items-center gap-2 px-6 py-3 border-b bg-muted/30 shrink-0">
					<div className="relative w-56 shrink-0">
						<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
						<Input
							placeholder="Search items..."
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							className="h-7 pl-8 text-xs"
						/>
					</div>
					{/* Horizontally scrollable filter badges — no truncation */}
					<div className="flex-1 min-w-0 overflow-x-auto [scrollbar-width:thin]">
						<div className="flex items-center gap-1 flex-nowrap w-max pr-2">
							<Filter className="size-3 text-muted-foreground mr-1 shrink-0" />
							{(
								[
									[
										"ready",
										`Ready${stats.ready > 0 ? ` (${stats.ready})` : ""}`,
									],
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
										"h-6 px-2 text-xs rounded-md border transition-colors whitespace-nowrap shrink-0",
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
							{/* File filter (only when >1 source file) */}
							{showFile && (
								<>
									<div className="w-px h-4 bg-border mx-1 shrink-0" />
									{sourceFiles.map((f) => (
										<button
											key={f}
											type="button"
											title={f}
											className={cn(
												"h-6 px-2 text-xs rounded-md border transition-colors whitespace-nowrap shrink-0 font-mono",
												fileFilter === f
													? "bg-foreground text-background border-foreground"
													: "bg-transparent text-muted-foreground border-border hover:bg-muted/50",
											)}
											onClick={() =>
												setFileFilter((prev) => (prev === f ? null : f))
											}
										>
											{f}
										</button>
									))}
								</>
							)}
						</div>
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
						{removableSelectedCount > 0 && (
							<Button
								variant="ghost"
								size="sm"
								className="h-7 text-xs text-destructive hover:text-destructive"
								onClick={requestRemoveSelected}
							>
								<Trash2 className="size-3 mr-1" />
								Remove ({removableSelectedCount})
							</Button>
						)}
						{reincludableSelectedCount > 0 && (
							<Button
								variant="ghost"
								size="sm"
								className="h-7 text-xs"
								onClick={handleReincludeSelected}
							>
								<UserCheck className="size-3 mr-1" />
								Re-include ({reincludableSelectedCount})
							</Button>
						)}
					</div>
				</div>

				{/* Content */}
				<ScrollArea className="flex-1 min-h-0">
					<div className="px-6 py-3 space-y-6">
						{phase === "loading" ? (
							<div className="flex items-center justify-center py-10 gap-2 text-sm text-muted-foreground">
								<Spinner className="size-4" /> Validating bundle...
							</div>
						) : filteredItems.length === 0 ? (
							<div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
								No items match your filters
							</div>
						) : (
							<>
								<ItemSection
									title="Profiles"
									items={filteredProfiles}
									showFile={showFile}
									selectedIds={selectedIds}
									expandedIds={expandedIds}
									pluginMap={pluginMap}
									onClick={handleItemClick}
									onToggleExpand={toggleExpand}
									onToggleSelect={toggleItemSelect}
									onToggleRemove={toggleItemRemove}
									onPluginChange={setPluginMapping}
								/>
								<ItemSection
									title="Autoruns"
									items={filteredAutoruns}
									showFile={showFile}
									selectedIds={selectedIds}
									expandedIds={expandedIds}
									pluginMap={pluginMap}
									onClick={handleItemClick}
									onToggleExpand={toggleExpand}
									onToggleSelect={toggleItemSelect}
									onToggleRemove={toggleItemRemove}
									onPluginChange={setPluginMapping}
								/>
							</>
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

			{/* Bulk-remove confirmation (2+ items) */}
			<AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							Remove {removableSelectedCount}{" "}
							{removableSelectedCount === 1 ? "item" : "items"}?
						</AlertDialogTitle>
						<AlertDialogDescription>
							These items will be excluded from the import. You can re-include
							them later from the Removed filter.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								handleRemoveSelected();
								setConfirmOpen(false);
							}}
						>
							Remove
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</Dialog>
	);
}

// ── Item Section (one per type) ───────────────────────────────

function ItemSection({
	title,
	items,
	showFile,
	selectedIds,
	expandedIds,
	pluginMap,
	onClick,
	onToggleExpand,
	onToggleSelect,
	onToggleRemove,
	onPluginChange,
}: {
	title: string;
	items: BundleItem[];
	showFile: boolean;
	selectedIds: Set<string>;
	expandedIds: Set<string>;
	pluginMap: PluginMap;
	onClick: (id: string, e: React.MouseEvent) => void;
	onToggleExpand: (id: string) => void;
	onToggleSelect: (id: string, checked: boolean) => void;
	onToggleRemove: (id: string) => void;
	onPluginChange: (hash: string, type: string, id: number) => void;
}) {
	if (items.length === 0) return null;
	return (
		<ItemSectionInner
			title={title}
			items={items}
			showFile={showFile}
			selectedIds={selectedIds}
			expandedIds={expandedIds}
			pluginMap={pluginMap}
			onClick={onClick}
			onToggleExpand={onToggleExpand}
			onToggleSelect={onToggleSelect}
			onToggleRemove={onToggleRemove}
			onPluginChange={onPluginChange}
		/>
	);
}

function ItemSectionInner({
	title,
	items,
	showFile,
	selectedIds,
	expandedIds,
	pluginMap,
	onClick,
	onToggleExpand,
	onToggleSelect,
	onToggleRemove,
	onPluginChange,
}: {
	title: string;
	items: BundleItem[];
	showFile: boolean;
	selectedIds: Set<string>;
	expandedIds: Set<string>;
	pluginMap: PluginMap;
	onClick: (id: string, e: React.MouseEvent) => void;
	onToggleExpand: (id: string) => void;
	onToggleSelect: (id: string, checked: boolean) => void;
	onToggleRemove: (id: string) => void;
	onPluginChange: (hash: string, type: string, id: number) => void;
}) {
	const isProfiles = title === "Profiles";

	// Column definitions: id + label + default width/flex + resizable.
	// Every data column is fixed + resizable; the trailing column flexes to
	// absorb leftover width so each drag handle moves only its own boundary.
	const columns = useMemo<ColumnDef[]>(() => {
		const base: ColumnDef[] = [
			{ id: "check", width: 28, resizable: false },
			{ id: "status", width: 96 },
			{ id: "name", width: 220, min: 80 },
		];
		if (isProfiles) {
			base.push(
				{ id: "engine", width: 120 },
				{ id: "resolver", width: 120 },
				// Trailing column flexes
				{ id: "retry", flex: 1, resizable: false, min: 60 },
			);
		} else {
			base.push(
				{ id: "profile", width: 140 },
				{ id: "start", width: 110 },
				// Trailing column flexes
				{ id: "end", flex: 1, resizable: false, min: 90 },
			);
		}
		// File column, when present, becomes the flexing trailing column and the
		// previous trailing column becomes fixed + resizable.
		if (showFile) {
			const last = base[base.length - 1];
			base[base.length - 1] = {
				...last,
				flex: undefined,
				width: 100,
				resizable: true,
			};
			base.push({ id: "file", flex: 1, resizable: false, min: 90 });
		}
		return base;
	}, [isProfiles, showFile]);

	const { gridTemplateColumns, handleProps } = useResizableColumns({
		storageKey: `import-dialog-cols-${isProfiles ? "profiles" : "autoruns"}-${showFile ? "multi" : "single"}`,
		columns,
	});

	// Header cells with drag handles between columns
	const headerCells: { id: string; label: string }[] = [
		{ id: "check", label: "" },
		{ id: "status", label: "Status" },
		{ id: "name", label: "Name" },
		...(isProfiles
			? [
					{ id: "engine", label: "Engine" },
					{ id: "resolver", label: "Resolver" },
					{ id: "retry", label: "Retry" },
				]
			: [
					{ id: "profile", label: "Profile" },
					{ id: "start", label: "Start" },
					{ id: "end", label: "End" },
				]),
		...(showFile ? [{ id: "file", label: "File" }] : []),
	];

	return (
		<section>
			<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">
				{title}{" "}
				<span className="text-foreground/70 font-medium">({items.length})</span>
			</h3>
			<div className="rounded-lg border overflow-hidden">
				{/* Column header */}
				<div
					className={cn(
						"grid items-stretch gap-x-3 px-3 border-b bg-muted/40",
						"text-micro font-medium uppercase tracking-wider text-muted-foreground",
					)}
					style={{ gridTemplateColumns }}
				>
					{headerCells.map((cell, idx) => {
						const handle = handleProps(cell.id);
						const isLast = idx === headerCells.length - 1;
						return (
							<div
								key={cell.id}
								className="relative flex items-center py-2 min-w-0"
							>
								<span className="truncate">{cell.label}</span>
								{handle && !isLast && (
									<div
										{...handle}
										className="absolute top-0 -right-1.5 h-full w-3 cursor-col-resize group/handle flex items-center justify-center z-10"
									>
										<div className="w-px h-4 bg-border group-hover/handle:bg-foreground/40 transition-colors" />
									</div>
								)}
							</div>
						);
					})}
				</div>
				{items.map((item) => (
					<ImportItemRow
						key={item.id}
						item={item}
						showFile={showFile}
						gridTemplateColumns={gridTemplateColumns}
						selected={selectedIds.has(item.id)}
						expanded={expandedIds.has(item.id)}
						pluginMap={pluginMap}
						onClick={onClick}
						onToggleExpand={onToggleExpand}
						onToggleSelect={onToggleSelect}
						onToggleRemove={onToggleRemove}
						onPluginChange={onPluginChange}
					/>
				))}
			</div>
		</section>
	);
}

// ── Summary Bar ──────────────────────────────────────────────

function SummaryBar({
	stats,
	fileCount,
}: {
	stats: ReturnType<typeof computeStats>;
	fileCount: number;
}) {
	const importable = stats.total - stats.removed;
	return (
		<div className="flex items-center gap-3 mt-2">
			<span className="text-xs text-muted-foreground">
				<span className="font-medium text-foreground">
					{stats.total} {stats.total === 1 ? "item" : "items"}
				</span>
				{fileCount > 1 && (
					<>
						{" "}
						from{" "}
						<span className="font-medium text-foreground">{fileCount}</span>{" "}
						files
					</>
				)}
			</span>
			{importable > 0 && (
				<div className="flex items-center gap-2">
					<div
						className="flex h-1.5 w-32 rounded-full overflow-hidden bg-muted"
						title={`${stats.profiles} profiles, ${stats.autoruns} autoruns`}
					>
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
					<span className="text-micro text-muted-foreground">
						<span className="text-blue-500 font-medium">{stats.profiles}p</span>
						{" · "}
						<span className="text-amber-500 font-medium">
							{stats.autoruns}a
						</span>
					</span>
				</div>
			)}
			{stats.issues > 0 && (
				<span className="text-micro text-amber-500 font-medium">
					{stats.issues} {stats.issues === 1 ? "issue" : "issues"}
				</span>
			)}
			{stats.removed > 0 && (
				<span className="text-micro text-destructive font-medium">
					{stats.removed} removed
				</span>
			)}
		</div>
	);
}

// ── Item Row ──────────────────────────────────────────────────

const STATUS_DOT: Record<BundleItem["status"] | "removed", string> = {
	ok: "bg-emerald-500",
	skip: "bg-emerald-500/60",
	rename: "bg-blue-500",
	issue: "bg-amber-500",
	removed: "bg-muted-foreground/40",
};

function ImportItemRow({
	item,
	showFile,
	gridTemplateColumns,
	selected,
	expanded,
	pluginMap,
	onClick,
	onToggleExpand,
	onToggleSelect,
	onToggleRemove,
	onPluginChange,
}: {
	item: BundleItem;
	showFile: boolean;
	gridTemplateColumns: string;
	selected: boolean;
	expanded: boolean;
	pluginMap: PluginMap;
	onClick: (id: string, e: React.MouseEvent) => void;
	onToggleExpand: (id: string) => void;
	onToggleSelect: (id: string, checked: boolean) => void;
	onToggleRemove: (id: string) => void;
	onPluginChange: (hash: string, type: string, id: number) => void;
}) {
	const isProfile = item.type === "profile";
	const name =
		(item.data.name as string) ??
		(item.data.user_friendly_name as string) ??
		"Untitled";
	const dotClass = STATUS_DOT[item.removed ? "removed" : item.status];

	// Profile-specific cells
	const engineName = (item.data.default_engine as PluginRef)?.name ?? "—";
	const resolverName = (item.data.resolver as PluginRef)?.name ?? "—";
	const retryMode = (item.data.retry_mode as string) ?? "none";

	// Autorun-specific cells
	const profileName = (item.data.profile_name as string) ?? "—";
	const startTime = item.data.start_time as string | undefined;
	const endTime = item.data.end_time as string | undefined;

	return (
		<div className="border-b last:border-b-0">
			{/* Main row */}
			{/* biome-ignore lint/a11y/useSemanticElements: row needs div for click+select+expand interaction */}
			<div
				className={cn(
					"grid items-center gap-x-3 px-3 py-2 select-none cursor-pointer transition-colors",
					"hover:bg-muted/40",
					expanded && "bg-muted/30",
					item.removed && "opacity-50",
					selected && !item.removed && "bg-primary/5",
				)}
				style={{ gridTemplateColumns }}
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
				{/* Checkbox */}
				{/* biome-ignore lint/a11y/noStaticElementInteractions: event boundary — checkbox stops propagation; Checkbox itself is interactive */}
				<span
					onClick={(e) => e.stopPropagation()}
					onKeyDown={(e) => e.stopPropagation()}
					className="flex items-center justify-center"
				>
					<Checkbox
						checked={selected}
						onCheckedChange={() => onToggleSelect(item.id, selected)}
						aria-label={`Select ${name}`}
						className="size-4"
					/>
				</span>
				{/* Status */}
				<span className="flex items-center gap-1.5 min-w-0">
					<span className={cn("size-1.5 rounded-full shrink-0", dotClass)} />
					<span className="text-xs text-muted-foreground truncate">
						{statusLabel(item)}
					</span>
				</span>
				{/* Name */}
				<span className="flex items-center gap-2 min-w-0">
					<ChevronRight
						className={cn(
							"size-3.5 shrink-0 transition-transform text-muted-foreground",
							expanded && "rotate-90",
						)}
					/>
					<span
						className={cn(
							"text-sm font-medium truncate",
							item.removed && "line-through",
						)}
					>
						{name}
					</span>
				</span>

				{isProfile ? (
					<>
						{/* Engine */}
						<span className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
							<Cpu className="size-3 shrink-0" />
							<span className="truncate">{engineName}</span>
						</span>
						{/* Resolver */}
						<span className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
							<Zap className="size-3 shrink-0" />
							<span className="truncate">{resolverName}</span>
						</span>
						{/* Retry */}
						<span className="text-xs text-muted-foreground font-mono truncate">
							{retryMode}
						</span>
					</>
				) : (
					<>
						{/* Profile */}
						<span className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
							<User className="size-3 shrink-0" />
							<span className="truncate">{profileName}</span>
						</span>
						{/* Start */}
						<span className="text-xs text-muted-foreground font-mono truncate">
							{formatShortTimestamp(startTime)}
						</span>
						{/* End */}
						<span className="text-xs text-muted-foreground font-mono truncate">
							{formatShortTimestamp(endTime)}
						</span>
					</>
				)}

				{/* File */}
				{showFile && (
					<span
						className="text-micro text-muted-foreground/70 truncate font-mono"
						title={item.sourceFile}
					>
						{item.sourceFile}
					</span>
				)}
			</div>

			{/* Inline accordion */}
			{expanded && (
				// biome-ignore lint/a11y/noStaticElementInteractions: stops event bubbling to row wrapper
				// biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation only, no click behavior
				<div
					className="border-t bg-muted/20"
					onClick={(e) => e.stopPropagation()}
				>
					<ExpandedShell>
						{isProfile ? (
							<ProfileExpanded
								data={item.data}
								issues={item.issues}
								pluginMap={pluginMap}
								removed={item.removed}
								onToggleRemove={() => onToggleRemove(item.id)}
								onPluginChange={onPluginChange}
							/>
						) : (
							<AutorunExpanded
								data={item.data}
								issues={item.issues}
								pluginMap={pluginMap}
								removed={item.removed}
								onToggleRemove={() => onToggleRemove(item.id)}
								onPluginChange={onPluginChange}
							/>
						)}
					</ExpandedShell>
				</div>
			)}
		</div>
	);
}

// ── Expanded Shell (shared by both types) ────────────────────

function ExpandedShell({ children }: { children: React.ReactNode }) {
	return <div className="px-6 py-4">{children}</div>;
}

// ── Remove / Re-include toggle (grid `actions` cell) ─────────

function RemoveToggle({
	removed,
	onToggleRemove,
}: {
	removed: boolean;
	onToggleRemove: () => void;
}) {
	return (
		<div className="flex items-center justify-end h-full">
			<Button
				variant="ghost"
				size="sm"
				className={cn(
					"h-6 text-xs",
					!removed && "text-destructive hover:text-destructive",
				)}
				onClick={onToggleRemove}
			>
				{removed ? (
					<>
						<UserCheck className="size-3 mr-1" /> Re-include
					</>
				) : (
					<>
						<Trash2 className="size-3 mr-1" /> Remove
					</>
				)}
			</Button>
		</div>
	);
}

// ── Hash Card (click-to-copy content hash) ───────────────────

function HashCard({ hash }: { hash?: string }) {
	const [hovered, setHovered] = useState(false);
	const [copied, copy] = useCopyToClipboard();

	if (!hash) return null;

	return (
		// biome-ignore lint/a11y/useSemanticElements: complex layout with hover/copy UX
		<div
			className="grid grid-cols-[auto_1fr] items-center gap-x-3 rounded-md border px-3 py-2.5 bg-muted/10 hover:bg-muted/20 transition-colors cursor-pointer select-none w-full h-full min-w-0"
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			onFocus={() => setHovered(true)}
			onBlur={() => setHovered(false)}
			onClick={() => copy(hash)}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					copy(hash);
				}
			}}
			role="button"
			tabIndex={0}
			title="Click to copy content hash"
		>
			{/* Big icon, spans both rows */}
			<Package className="size-6 text-muted-foreground row-span-2 shrink-0" />
			{/* Row 1: thick header */}
			<p className="text-micro font-semibold text-muted-foreground uppercase tracking-wider self-end">
				Content Hash
			</p>
			{/* Row 2: hash value / hover-copy */}
			<div className="relative h-4 min-w-0 self-start">
				<p
					className={cn(
						"absolute inset-0 flex items-center text-xs font-mono truncate transition-opacity duration-200",
						hovered ? "opacity-0" : "opacity-100",
					)}
				>
					{hash}
				</p>
				<p
					className={cn(
						"absolute inset-0 flex items-center gap-1 text-micro font-medium transition-opacity duration-200",
						hovered ? "opacity-100" : "opacity-0",
						copied ? "text-emerald-500" : "text-muted-foreground",
					)}
				>
					{copied ? (
						<>
							<Check className="size-3 shrink-0" /> Copied to clipboard
						</>
					) : (
						<>
							<Copy className="size-3 shrink-0" /> Copy full hash
						</>
					)}
				</p>
			</div>
		</div>
	);
}

// ── Profile Expanded Content ─────────────────────────────────

function ProfileExpanded({
	data,
	issues,
	pluginMap,
	removed,
	onToggleRemove,
	onPluginChange,
}: {
	data: Record<string, unknown>;
	issues: Issue[];
	pluginMap: PluginMap;
	removed: boolean;
	onToggleRemove: () => void;
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
	const isMobile = useIsMobile();

	return (
		<div className="grid gap-3 w-full" style={isMobile ? PROFILE_EXPANDED.styleStacked() : PROFILE_EXPANDED.style}>
			<div style={{ gridArea: AREAS.hash }} className="min-w-0 h-full">
				<HashCard hash={contentHash} />
			</div>
			<div style={{ gridArea: AREAS.engine }} className="h-full">
				<PluginCell icon={Cpu} label="Engine" plugin={engine} />
			</div>
			<div style={{ gridArea: AREAS.resolver }} className="h-full">
				<PluginCell icon={Zap} label="Resolver" plugin={resolver} />
			</div>
			<div style={{ gridArea: AREAS.actions }} className="h-full">
				<RemoveToggle removed={removed} onToggleRemove={onToggleRemove} />
			</div>
			<div style={{ gridArea: AREAS.retry }} className="space-y-2">
				{retryMode !== "none" && (
					<p className="text-xs text-muted-foreground">
						Retry mode: <span className="font-mono">{retryMode}</span>
					</p>
				)}
			</div>
			<div style={{ gridArea: AREAS.configs }} className="space-y-3">
				{resolverConfig && Object.keys(resolverConfig).length > 0 && (
					<ConfigPreview title="Resolver config" config={resolverConfig} />
				)}
				{retryMode !== "none" &&
					retryConfig &&
					Object.keys(retryConfig).length > 0 && (
						<ConfigPreview title="Retry config" config={retryConfig} />
					)}
				<IssueList
					issues={issues}
					pluginMap={pluginMap}
					onChange={onPluginChange}
				/>
			</div>
		</div>
	);
}

// ── Autorun Expanded Content ─────────────────────────────────

function AutorunExpanded({
	data,
	issues,
	pluginMap,
	removed,
	onToggleRemove,
	onPluginChange,
}: {
	data: Record<string, unknown>;
	issues: Issue[];
	pluginMap: PluginMap;
	removed: boolean;
	onToggleRemove: () => void;
	onPluginChange: (hash: string, type: string, id: number) => void;
}) {
	const [, copyHash] = useCopyToClipboard();
	const engineOverride = data.engine_override as PluginRef | undefined;
	const profileName = (data.profile_name as string) ?? "—";
	const startTime = data.start_time as string | undefined;
	const endTime = data.end_time as string | undefined;
	const contentHash = data.content_hash as string | undefined;
	const isMobile = useIsMobile();

	return (
		<div className="grid gap-3 w-full" style={isMobile ? AUTORUN_EXPANDED.styleStacked() : AUTORUN_EXPANDED.style}>
			{/* Content hash — first cell of the content row */}
			<div style={{ gridArea: AREAS.hash }} className="min-w-0 h-full">
				<HashCard hash={contentHash} />
			</div>
			{/* Remove/Re-include — trails row 1 */}
			<div style={{ gridArea: AREAS.actions }} className="h-full">
				<RemoveToggle removed={removed} onToggleRemove={onToggleRemove} />
			</div>
			{/* Schedule: full timestamps + live ETA */}
			<div
				style={{ gridArea: AREAS.schedule }}
				className="rounded-md border bg-muted/10 px-3 py-2.5 space-y-2"
			>
				<div className="flex items-center justify-between gap-3">
					<Label className="text-micro text-muted-foreground uppercase tracking-wider">
						Schedule
					</Label>
					<LiveEta start={startTime} end={endTime} />
				</div>
				<div className="grid gap-2 sm:grid-cols-2">
					<div className="space-y-0.5">
						<p className="text-micro text-muted-foreground/70 uppercase tracking-wider">
							Start
						</p>
						<p className="text-xs font-medium">
							{formatFullTimestamp(startTime)}
						</p>
					</div>
					<div className="space-y-0.5">
						<p className="text-micro text-muted-foreground/70 uppercase tracking-wider">
							End
						</p>
						<p className="text-xs font-medium">
							{formatFullTimestamp(endTime)}
						</p>
					</div>
				</div>
			</div>

			{/* Profile */}
			<div style={{ gridArea: AREAS.profile }}>
				<div className="flex items-center gap-2 rounded-md border px-2.5 py-2 bg-muted/10 h-full">
					<User className="size-3.5 text-muted-foreground shrink-0" />
					<div className="min-w-0">
						<p className="text-micro text-muted-foreground uppercase tracking-wider">
							Profile
						</p>
						<p className="text-xs font-medium truncate">{profileName}</p>
					</div>
				</div>
			</div>

			{/* Engine override */}
			<div style={{ gridArea: AREAS.engine }}>
				{engineOverride ? (
					<div className="flex items-center gap-2 rounded-md border px-2.5 py-2 bg-muted/10 h-full">
						<Cpu className="size-3.5 text-muted-foreground shrink-0" />
						<div className="min-w-0 flex-1">
							<p className="text-micro text-muted-foreground uppercase tracking-wider">
								Engine override
							</p>
							<p className="text-xs font-medium truncate">
								{engineOverride.name}
							</p>
						</div>
						{engineOverride.origin_hash && (
							<button
								type="button"
								tabIndex={-1}
								onMouseDown={(e) => e.preventDefault()}
								className="font-mono text-micro text-muted-foreground/60 hover:text-muted-foreground transition-colors cursor-pointer shrink-0"
								onClick={() => copyHash(engineOverride.origin_hash)}
								title="Click to copy hash"
							>
								{engineOverride.origin_hash.slice(0, 8)}
							</button>
						)}
					</div>
				) : (
					<div className="flex items-center gap-2 rounded-md border border-dashed px-2.5 py-2 h-full">
						<Cpu className="size-3.5 text-muted-foreground/50 shrink-0" />
						<p className="text-xs text-muted-foreground/70">
							No engine override
						</p>
					</div>
				)}
			</div>

			{/* Issues */}
			<div style={{ gridArea: AREAS.configs }} className="space-y-3">
				<IssueList
					issues={issues}
					pluginMap={pluginMap}
					onChange={onPluginChange}
				/>
			</div>
		</div>
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
			className="flex items-center gap-2 rounded-md border px-2.5 py-2 bg-muted/10 hover:bg-muted/20 transition-colors cursor-pointer select-none h-full"
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
				<p className="text-micro text-muted-foreground uppercase tracking-wider">
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
							"absolute inset-0 flex items-center gap-1 text-micro font-mono text-muted-foreground transition-opacity duration-200",
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
			<Label className="text-micro text-muted-foreground uppercase tracking-wider">
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
				<span className="text-micro text-muted-foreground font-mono truncate max-w-[120px]">
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
					<Label className="text-micro">Map to:</Label>
					<Select
						items={issueAlternatives}
						value={currentSelection ? String(currentSelection.id) : ""}
						onValueChange={(v: string) => {
							const id = Number(v);
							if (v !== "" && !Number.isNaN(id)) {
								onChange(currentHash, issue.field ?? "", id);
							}
						}}
					>
						<SelectTrigger className="h-7 text-xs w-full">
							<SelectValue placeholder="Select plugin" />
						</SelectTrigger>
						<SelectContent>
							{issue.alternatives.map((alt) => (
								<SelectItem key={alt.id} value={String(alt.id)}>
									{alt.name}{" "}
									<span className="text-micro text-muted-foreground ml-1">
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
