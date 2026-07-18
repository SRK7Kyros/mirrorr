import {
	Check,
	ChevronDown,
	ChevronRight,
	Copy,
	Maximize2,
	Minimize2,
	RefreshCw,
	Trash2,
	Wifi,
	X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Rnd } from "react-rnd";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { useInterval } from "@/hooks/use-interval";
import { tokenStatus } from "@/lib/api";
import { AREAS, NETWORK_MONITOR_SHELL, NETWORK_ROW } from "@/lib/layouts";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import {
	type RequestLogEntry,
	useRequestLogStore,
} from "@/stores/request-log-store";

// ── Backend status color helper ────────────────────────────────

function getBackendStatusColor(status: string): string {
	switch (status) {
		case "connected":
			return "bg-emerald-500";
		case "disconnected":
			return "bg-red-500";
		default:
			return "bg-amber-500 animate-pulse";
	}
}

// ── Status indicator for the navbar ─────────────────────────────

export function NetworkStatusDot() {
	const backendStatus = useRequestLogStore((s) => s.backendStatus);
	const lastErrorAt = useRequestLogStore((s) => s.lastErrorAt);
	const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
	const [showAge, setShowAge] = useState<string | null>(null);
	const auth = tokenStatus();

	useInterval(
		() => {
			if (!lastErrorAt) return;
			const secs = Math.floor((Date.now() - lastErrorAt) / 1000);
			setShowAge(secs < 60 ? `${secs}s ago` : `${Math.floor(secs / 60)}m ago`);
		},
		lastErrorAt ? 5000 : null,
	);

	// Color priority: auth issues > backend issues > all good.
	// With cookie auth we can only know "valid" or "none" client-side;
	// the backend enforces real expiry and a 401 triggers refresh/logout.
	const color =
		!isAuthenticated || auth === "expired"
			? "bg-red-500"
			: getBackendStatusColor(backendStatus);

	const label = (() => {
		if (!isAuthenticated) return "Auth off";
		if (auth === "expired") return "Expired";
		if (backendStatus === "connected") return "OK";
		if (backendStatus === "disconnected") return "Down";
		return "…";
	})();

	const title = (() => {
		if (!isAuthenticated) return "Not authenticated";
		if (auth === "expired") return "Session expired";
		if (backendStatus === "connected") return "Connected · Session valid";
		if (backendStatus === "disconnected")
			return `Disconnected${showAge ? ` (${showAge})` : ""}`;
		return "Checking…";
	})();

	return (
		<span className="flex items-center gap-1.5 shrink-0" title={title}>
			<span className={cn("size-2 rounded-full shrink-0", color)} />
			<span className="text-[10px] text-muted-foreground font-medium w-[8.5ch] text-left">
				{label}
			</span>
		</span>
	);
}

// ── Floating network monitor window ─────────────────────────────
export function NetworkStatusTracker() {
	const entries = useRequestLogStore((s) => s.entries);
	const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

	// Track backend health from API responses
	useEffect(() => {
		if (entries.length === 0) return;
		const latest = entries[0];
		if (latest.ok === true) {
			useRequestLogStore.getState().setBackendStatus("connected");
		}
	}, [entries]);

	// Periodic health ping — the single source of truth for backend status
	const check = useCallback(async () => {
		const base = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
		try {
			const res = await fetch(`${base}/auth/status`, { method: "GET" });
			if (res.ok) {
				useRequestLogStore.getState().setBackendStatus("connected");
			} else {
				useRequestLogStore.getState().setBackendStatus("disconnected");
			}
		} catch {
			useRequestLogStore.getState().setBackendStatus("disconnected");
		}
	}, []);

	// Initial check on mount / auth change
	useEffect(() => {
		if (isAuthenticated) check();
	}, [isAuthenticated, check]);

	useInterval(check, isAuthenticated ? 15_000 : null);

	return null;
}

function tryParseJson(str: string): unknown {
	try {
		return JSON.parse(str);
	} catch {
		return str;
	}
}

export function NetworkMonitor({
	open,
	onClose,
	defaultPos,
}: {
	open: boolean;
	onClose: () => void;
	defaultPos?: { x: number; y: number };
}) {
	const entries = useRequestLogStore((s) => s.entries);
	const backendStatus = useRequestLogStore((s) => s.backendStatus);
	const clear = useRequestLogStore((s) => s.clear);
	const [expandedId, setExpandedId] = useState<number | null>(null);
	const [minimized, setMinimized] = useState(false);
	const [size, setSize] = useState({ width: 420, height: 500 });
	const [pos, setPos] = useState({ x: 80, y: 80 });
	const [hasPositioned, setHasPositioned] = useState(false);

	// Position below the trigger when first opened
	useEffect(() => {
		if (open && defaultPos && !hasPositioned) {
			setPos(defaultPos);
			setHasPositioned(true);
		}
		if (!open) {
			setHasPositioned(false);
		}
	}, [open, defaultPos, hasPositioned]);
	useEffect(() => {
		setSize(
			minimized ? { width: 420, height: 42 } : { width: 420, height: 500 },
		);
	}, [minimized]);

	if (!open) return null;

	return (
		<Rnd
			size={size}
			position={pos}
			onDragStop={(_, d) => setPos({ x: d.x, y: d.y })}
			onResizeStop={(_, __, ref, ___, position) => {
				setSize({ width: ref.offsetWidth, height: ref.offsetHeight });
				setPos(position);
			}}
			minWidth={320}
			minHeight={minimized ? 42 : 200}
			bounds="parent"
			dragHandleClassName="drag-handle"
			enableResizing={!minimized}
		>
			<div
				className="h-full bg-card border rounded-xl shadow-2xl overflow-hidden"
				style={NETWORK_MONITOR_SHELL.style}
			>
				{/* Header — always visible, draggable */}
				<div
					className="drag-handle h-10 shrink-0 flex items-center gap-2 px-3 border-b bg-muted/30 cursor-move select-none"
					style={{ gridArea: AREAS.header }}
				>
					<Wifi className="size-3.5 text-muted-foreground" />
					<span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
						Network
					</span>
					<div
						className={cn(
							"size-1.5 rounded-full ml-0.5",
							getBackendStatusColor(backendStatus),
						)}
					/>
					<div className="flex-1" />
					<span className="text-[10px] text-muted-foreground font-mono mr-1">
						{entries.length} reqs
					</span>
					<Button
						variant="ghost"
						size="icon-xs"
						className="size-5"
						onClick={clear}
						title="Clear log"
						aria-label="Clear log"
					>
						<Trash2 className="size-3" />
					</Button>
					<Button
						variant="ghost"
						size="icon-xs"
						className="size-5"
						onClick={() => setMinimized(!minimized)}
						title={minimized ? "Expand" : "Minimize"}
						aria-label={minimized ? "Expand" : "Minimize"}
					>
						{minimized ? (
							<Maximize2 className="size-3" />
						) : (
							<Minimize2 className="size-3" />
						)}
					</Button>
					<Button
						variant="ghost"
						size="icon-xs"
						className="size-5"
						onClick={onClose}
						title="Close"
						aria-label="Close"
					>
						<X className="size-3" />
					</Button>
				</div>

				{/* Body */}
				{!minimized && (
					<ScrollArea className="min-h-0" style={{ gridArea: AREAS.content }}>
						{entries.length === 0 ? (
							<EmptyState text="No requests yet" height="sm" icon={RefreshCw} />
						) : (
							<div>
								{/* Header row */}
								<div className="grid px-3" style={NETWORK_ROW.style}>
									<span
										className="text-[9px] text-muted-subtle font-mono uppercase py-1"
										style={{ gridArea: AREAS.time }}
									>
										Time
									</span>
									<span
										className="text-[9px] text-muted-subtle font-mono uppercase py-1"
										style={{ gridArea: AREAS.method }}
									>
										Method
									</span>
									<span
										className="text-[9px] text-muted-subtle font-mono uppercase py-1"
										style={{ gridArea: AREAS.status }}
									>
										St
									</span>
									<span
										className="text-[9px] text-muted-subtle font-mono uppercase py-1"
										style={{ gridArea: AREAS.path }}
									>
										Path
									</span>
									<span
										className="text-[9px] text-muted-subtle font-mono uppercase py-1 text-right"
										style={{ gridArea: AREAS.dur }}
									>
										Dur
									</span>
									<span
										className="py-1"
										style={{ gridArea: AREAS.actions_net }}
									/>
								</div>
								{entries.map((entry) => (
									<RequestRow
										key={entry.id}
										entry={entry}
										expanded={expandedId === entry.id}
										onToggle={() =>
											setExpandedId(expandedId === entry.id ? null : entry.id)
										}
									/>
								))}
							</div>
						)}
					</ScrollArea>
				)}
			</div>
		</Rnd>
	);
}

// ── Single request row ──────────────────────────────────────────

function RequestRow({
	entry,
	expanded,
	onToggle,
}: {
	entry: RequestLogEntry;
	expanded: boolean;
	onToggle: () => void;
}) {
	const [copiedAll, copyAll] = useCopyToClipboard();
	const methodColor =
		entry.type === "ws-event"
			? "text-cyan-600 dark:text-cyan-400"
			: entry.type === "ws-notif"
				? "text-violet-600 dark:text-violet-400"
				: ({
						GET: "text-emerald-600 dark:text-emerald-400",
						POST: "text-blue-600 dark:text-blue-400",
						PUT: "text-amber-600 dark:text-amber-400",
						DELETE: "text-red-600 dark:text-red-400",
						PATCH: "text-purple-600 dark:text-purple-400",
					}[entry.method] ?? "text-muted-foreground");

	const statusColor =
		entry.status === null
			? "text-muted-foreground"
			: entry.ok
				? "text-emerald-600 dark:text-emerald-400"
				: entry.status === 401 || entry.status === 403
					? "text-amber-600 dark:text-amber-400"
					: "text-red-600 dark:text-red-400";

	const time = new Date(entry.timestamp).toLocaleTimeString(undefined, {
		hour12: false,
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});

	return (
		<div>
			{/* Main row — its own grid */}
			{/* biome-ignore lint/a11y/useSemanticElements: grid layout with multiple spans cannot be a button */}
			<div
				className="grid px-3 cursor-pointer hover:bg-muted/30 transition-colors"
				style={NETWORK_ROW.style}
				onClick={onToggle}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						onToggle();
					}
				}}
				role="button"
				tabIndex={0}
			>
				<span
					className="text-[10px] text-muted-subtle font-mono py-1.5 flex items-center"
					style={{ gridArea: AREAS.time }}
				>
					{time}
				</span>
				<span
					className={cn(
						"text-[10px] font-bold font-mono uppercase py-1.5 flex items-center",
						methodColor,
					)}
					style={{ gridArea: AREAS.method }}
				>
					{entry.method}
				</span>
				<span
					className={cn(
						"text-[10px] font-mono py-1.5 flex items-center",
						statusColor,
					)}
					style={{ gridArea: AREAS.status }}
				>
					{entry.status ?? "—"}
				</span>
				<span
					className="text-xs truncate text-muted-foreground py-1.5 flex items-center"
					style={{ gridArea: AREAS.path }}
				>
					{entry.path}
				</span>
				<span
					className="text-[10px] text-muted-subtle font-mono text-right py-1.5 flex items-center justify-end"
					style={{ gridArea: AREAS.dur }}
				>
					{entry.duration !== null
						? entry.duration < 1000
							? `${entry.duration}ms`
							: `${(entry.duration / 1000).toFixed(1)}s`
						: "—"}
				</span>
				<span
					className="py-1.5 flex items-center justify-center gap-0.5"
					style={{ gridArea: AREAS.actions_net }}
				>
					<Button
						variant="ghost"
						size="icon-xs"
						title="Copy all as JSON"
						onClick={(e) => {
							e.stopPropagation();
							const obj: Record<string, unknown> = {
								method: entry.method,
								url: entry.url,
								path: entry.path,
								status: entry.status,
								duration_ms: entry.duration,
							};
							if (entry.requestBody)
								obj.requestBody = tryParseJson(entry.requestBody);
							if (entry.responseBody)
								obj.responseBody = tryParseJson(entry.responseBody);
							if (entry.error) obj.error = entry.error;
							copyAll(JSON.stringify(obj, null, 2));
						}}
					>
						{copiedAll ? (
							<Check className="size-3 text-emerald-500" />
						) : (
							<Copy className="size-3 text-muted-ghost" />
						)}
					</Button>
					{expanded ? (
						<ChevronDown className="size-3 text-muted-ghost" />
					) : (
						<ChevronRight className="size-3 text-muted-ghost" />
					)}
				</span>
			</div>
			{/* Expanded details — card layout */}
			{expanded && (
				<div className="px-2 pb-2 pt-1 space-y-1.5 bg-muted/15 border-t border-border/35">
					<DetailCard label="URL" value={entry.url} />
					{entry.requestBody && (
						<DetailCard label="Request Body" value={entry.requestBody} mono />
					)}
					{entry.responseBody && (
						<DetailCard label="Response" value={entry.responseBody} mono />
					)}
					{entry.error && <DetailCard label="Error" value={entry.error} />}
				</div>
			)}
		</div>
	);
}

// ── Detail card ─────────────────────────────────────────────────

function DetailCard({
	label,
	value,
	mono,
}: {
	label: string;
	value: string;
	mono?: boolean;
}) {
	const [copied, copy] = useCopyToClipboard(1200);
	const [expanded, setExpanded] = useState(false);

	// Pretty-print JSON if it has more than 2 top-level keys
	const displayValue = (() => {
		if (!mono) return value;
		try {
			const parsed = JSON.parse(value);
			if (
				typeof parsed === "object" &&
				parsed !== null &&
				!Array.isArray(parsed) &&
				Object.keys(parsed).length > 2
			) {
				return JSON.stringify(parsed, null, 2);
			}
			if (
				Array.isArray(parsed) &&
				parsed.length > 0 &&
				typeof parsed[0] === "object" &&
				parsed[0] !== null &&
				Object.keys(parsed[0]).length > 2
			) {
				return JSON.stringify(parsed, null, 2);
			}
		} catch {
			/* not JSON */
		}
		return value;
	})();

	return (
		<>
			<div className="rounded-md border border-border/60 bg-muted/30 overflow-hidden">
				{/* Card header */}
				<div className="flex items-center gap-1 px-2 py-1 border-b border-border/40 bg-muted/20">
					<span className="text-[9px] text-muted-subtle uppercase tracking-wider flex-1">
						{label}
					</span>
					<Button
						variant="ghost"
						size="icon-xs"
						onClick={(e) => {
							e.stopPropagation();
							setExpanded(true);
						}}
						title="Expand"
					>
						<Maximize2 className="size-3 text-muted-faint" />
					</Button>
					<Button
						variant="ghost"
						size="icon-xs"
						onClick={(e) => {
							e.stopPropagation();
							copy(value);
						}}
						title="Copy to clipboard"
					>
						{copied ? (
							<Check className="size-3 text-emerald-500" />
						) : (
							<Copy className="size-3 text-muted-faint" />
						)}
					</Button>
				</div>
				{/* Card content */}
				<div
					className={cn(
						"text-[10px] px-2 py-1.5 max-h-32 overflow-x-auto overflow-y-auto break-words scrollbar-thin",
						mono ? "font-mono text-muted-foreground" : "text-foreground",
					)}
				>
					<span className="whitespace-pre">{displayValue}</span>
				</div>
			</div>

			{/* Fullscreen panel — portaled to body to escape Rnd's transform */}
			{expanded &&
				createPortal(
					// biome-ignore lint/a11y/useSemanticElements: modal overlay cannot be a button
					<div
						className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
						onClick={() => setExpanded(false)}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								setExpanded(false);
							}
						}}
						role="button"
						tabIndex={-1}
					>
						{/* biome-ignore lint/a11y/noStaticElementInteractions: stops click from closing modal */}
						<div
							className="bg-card border rounded-lg shadow-xl w-[90vw] max-w-3xl h-[80vh] flex flex-col"
							onClick={(e) => e.stopPropagation()}
							onKeyDown={(e) => e.stopPropagation()}
						>
							<div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0">
								<h3 className="text-xs font-semibold">{label}</h3>
								<div className="flex items-center gap-2">
									<Button
										variant="ghost"
										size="icon-xs"
										onClick={(e) => {
											e.stopPropagation();
											copy(value);
										}}
										title="Copy to clipboard"
									>
										{copied ? (
											<Check className="size-3.5 text-emerald-500" />
										) : (
											<Copy className="size-3.5 text-muted-foreground" />
										)}
									</Button>
									<Button
										variant="ghost"
										size="sm"
										onClick={() => setExpanded(false)}
									>
										Close
									</Button>
								</div>
							</div>
							<ScrollArea className="flex-1 min-h-0">
								<pre
									className={cn(
										"p-4 text-xs leading-relaxed whitespace-pre",
										mono
											? "font-mono text-muted-foreground"
											: "text-foreground",
									)}
								>
									{displayValue}
								</pre>
							</ScrollArea>
						</div>
					</div>,
					document.body,
				)}
		</>
	);
}
