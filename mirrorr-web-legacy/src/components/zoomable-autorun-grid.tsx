import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { autorunsApi, ApiError } from "@/lib/api";
import { parseUtcDate, toUtcNaive, cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { DateTimePicker } from "@/components/datetime-picker";
import {
	Sheet,
	SheetContent,
	SheetTitle,
} from "@/components/ui/sheet";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import type { Autorun } from "@/lib/schemas";

export type ZoomTier = 1 | 2 | 3 | 4;

const TIER_ATTR = "data-tier";

const STATUS_COLOR: Record<string, string> = {
	scheduled: "var(--zoom-scheduled, #3b82f6)",
	active: "var(--zoom-live, #ef4444)",
	recording: "var(--zoom-live, #ef4444)",
	terminating: "var(--zoom-teardown, #a855f7)",
	remuxing: "var(--zoom-teardown, #a855f7)",
	finalizing: "var(--zoom-teardown, #a855f7)",
	completed: "var(--zoom-done, #22c55e)",
	failed: "var(--zoom-failed, #f59e0b)",
};

function statusColor(status: string | null | undefined): string {
	return STATUS_COLOR[status ?? "scheduled"] ?? "var(--zoom-scheduled, #3b82f6)";
}

const LIVE_STATUSES = new Set(["active", "recording", "terminating", "remuxing", "finalizing"]);
const SPENT_STATUSES = new Set(["completed", "failed"]);

function isOverdue(a: Autorun, now: number): boolean {
	if ((a.status ?? "scheduled") !== "scheduled") return false;
	const s = parseUtcDate(a.start_time);
	return !!s && s.getTime() <= now;
}

function dayKey(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function startOfDay(d: Date): Date {
	const c = new Date(d);
	c.setHours(0, 0, 0, 0);
	return c;
}

function hhmm(value: string | null | undefined): string {
	const d = parseUtcDate(value);
	if (!d || Number.isNaN(d.getTime())) return "--:--";
	const p = (n: number) => String(n).padStart(2, "0");
	return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function monthCells(year: number, month: number): Date[] {
	const first = new Date(year, month, 1);
	// Monday-start offset
	const offset = (first.getDay() + 6) % 7;
	const start = new Date(year, month, 1 - offset);
	const cells: Date[] = [];
	for (let i = 0; i < 42; i++) {
		cells.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
	}
	return cells;
}

export function ZoomableAutorunGrid({
	autoruns,
	selectedId,
	onSelect,
	onDuplicate,
}: {
	autoruns: Autorun[];
	selectedId?: number | null;
	onSelect?: (id: number) => void;
	onDuplicate?: (a: Autorun) => void;
}) {
	const isMobile = useIsMobile();
	const queryClient = useQueryClient();
	const [cursor, setCursor] = useState(() => {
		const d = new Date();
		return new Date(d.getFullYear(), d.getMonth(), 1);
	});
	const [tier, setTier] = useState<ZoomTier>(() =>
		typeof window !== "undefined" && window.innerWidth >= 1024 ? 4 : isMobile ? 2 : 3,
	);
	const [focusDay, setFocusDay] = useState<Date | null>(null);
	const [editId, setEditId] = useState<number | null>(null);
	const [reduceMotion, setReduceMotion] = useState(
		() =>
			typeof window !== "undefined" &&
			window.matchMedia("(prefers-reduced-motion: reduce)").matches,
	);
	useEffect(() => {
		const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
		const onChange = () => setReduceMotion(mq.matches);
		mq.addEventListener("change", onChange);
		return () => mq.removeEventListener("change", onChange);
	}, []);
	const gridRef = useRef<HTMLDivElement>(null);
	const touchRef = useRef<{ d0: number; tier0: ZoomTier } | null>(null);
	const snapTimer = useRef<number | null>(null);
	const lastTap = useRef<number>(0);

	const now = Date.now();
	const cells = useMemo(
		() => monthCells(cursor.getFullYear(), cursor.getMonth()),
		[cursor],
	);

	const byDay = useMemo(() => {
		const map = new Map<string, Autorun[]>();
		for (const a of autoruns) {
			const s = parseUtcDate(a.start_time);
			const e = parseUtcDate(a.end_time);
			if (!s || !e || Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) continue;
			const day = new Date(s);
			day.setHours(0, 0, 0, 0);
			const endDay = new Date(e);
			endDay.setHours(0, 0, 0, 0);
			for (let d = new Date(day); d <= endDay; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
				const k = dayKey(d);
				const arr = map.get(k) ?? [];
				arr.push(a);
				map.set(k, arr);
			}
		}
		return map;
	}, [autoruns]);

	const focusAutoruns = useMemo(() => {
		if (!focusDay) return [];
		return (byDay.get(dayKey(focusDay)) ?? []).slice().sort((a, b) => {
			const sa = parseUtcDate(a.start_time)?.getTime() ?? 0;
			const sb = parseUtcDate(b.start_time)?.getTime() ?? 0;
			return sa - sb;
		});
	}, [byDay, focusDay]);

	function applySnap(next: ZoomTier) {
		if (snapTimer.current) window.clearTimeout(snapTimer.current);
		if (reduceMotion) {
			setTier(next);
			return;
		}
		snapTimer.current = window.setTimeout(() => setTier(next), 120);
	}

	function onTouchStart(e: React.TouchEvent) {
		if (e.touches.length === 2) {
			const [a, b] = [e.touches[0], e.touches[1]];
			const d0 = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
			touchRef.current = { d0, tier0: tier };
		}
	}

	function onTouchMove(e: React.TouchEvent) {
		const t = touchRef.current;
		if (!t || e.touches.length !== 2) return;
		e.preventDefault();
		const [a, b] = [e.touches[0], e.touches[1]];
		const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
		const steps = Math.trunc((d - t.d0) / 60);
		if (steps !== 0) {
			const next = Math.min(4, Math.max(1, t.tier0 + steps)) as ZoomTier;
			setTier(next);
		}
	}

	function onTouchEnd() {
		if (!touchRef.current) return;
		const rested = tier;
		touchRef.current = null;
		applySnap(rested);
	}

	function handleCellTap(day: Date) {
		const t = Date.now();
		if (t - lastTap.current < 300) {
			lastTap.current = 0;
			setFocusDay(startOfDay(day));
			return;
		}
		lastTap.current = t;
	}

	function openDay(day: Date) {
		setFocusDay(startOfDay(day));
	}

	const monthLabel = cursor.toLocaleString(undefined, { month: "long", year: "numeric" });
	const today = startOfDay(new Date());

	if (focusDay) {
		return (
			<DayFocus
				day={focusDay}
				items={focusAutoruns}
				selectedId={selectedId}
				onBack={() => setFocusDay(null)}
				onToday={() => {
					setFocusDay(today);
					setCursor(new Date(today.getFullYear(), today.getMonth(), 1));
				}}
				onEdit={(id) => setEditId(id)}
			/>
		);
	}

	return (
		<div className="flex flex-col min-h-0">
			<div className="flex items-center gap-1 px-2 py-2">
				<Button variant="ghost" size="icon-sm" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} aria-label="Previous month">
					<ChevronLeft className="size-4" />
				</Button>
				<div className="flex-1 text-center text-sm font-semibold">{monthLabel}</div>
				<Button variant="ghost" size="icon-sm" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} aria-label="Next month">
					<ChevronRight className="size-4" />
				</Button>
				<Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => {
					setCursor(new Date(today.getFullYear(), today.getMonth(), 1));
				}}>
					Today
				</Button>
			</div>
			<div className="grid grid-cols-7 px-2 pb-1 text-micro font-medium text-muted-foreground">
				{["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
					<div key={i} className="text-center">{d}</div>
				))}
			</div>
			<div
				ref={gridRef}
				{...{ [TIER_ATTR]: tier }}
				data-testid="zoom-grid"
				onTouchStart={onTouchStart}
				onTouchMove={onTouchMove}
				onTouchEnd={onTouchEnd}
				className="grid grid-cols-7 gap-px px-2 pb-4 overflow-y-auto"
				style={{ touchAction: "pan-y pinch-zoom" }}
			>
				{cells.map((day, i) => {
					const inMonth = day.getMonth() === cursor.getMonth();
					const items = (byDay.get(dayKey(day)) ?? []).slice(0, tier === 1 ? 3 : tier === 2 ? 3 : 4);
					const total = (byDay.get(dayKey(day)) ?? []).length;
					const isToday = dayKey(day) === dayKey(today);
					return (
						<div
							key={i}
							data-testid="zoom-cell"
							data-day={dayKey(day)}
							onClick={() => handleCellTap(day)}
							onDoubleClick={() => openDay(day)}
							className={cn(
								"min-h-11 rounded-md border p-1 flex flex-col gap-0.5 overflow-hidden",
								tier === 1 && "min-h-11",
								tier === 2 && "min-h-16",
								tier === 3 && "min-h-24",
								tier === 4 && "min-h-32",
								!inMonth && "opacity-50",
								selectedId && items.some((a) => a.id === selectedId) && "ring-1 ring-primary",
							)}
						>
							<div className={cn(
								"text-micro font-semibold leading-4",
								isToday && "bg-red-500 text-white rounded-full size-5 flex items-center justify-center",
							)}>
								{day.getDate()}
							</div>
							{tier === 1 && (
								<div className="flex items-center gap-0.5 flex-wrap">
									{items.slice(0, 3).map((a) => (
										<span key={a.id} className="size-1.5 rounded-full" style={{ background: statusColor(a.status) }} />
									))}
									{total > 3 && <span className="text-micro text-muted-foreground">+{total - 3}</span>}
								</div>
							)}
							{tier === 2 && (
								<div className="flex flex-col gap-0.5">
									{items.slice(0, 3).map((a) => (
										<span key={a.id} className="h-1.5 rounded-full w-full" style={{ background: statusColor(a.status) }} />
									))}
									{total > 3 && <span className="text-micro text-muted-foreground">+{total - 3}</span>}
								</div>
							)}
							{tier >= 3 && (
								<div className="flex flex-col gap-0.5 min-h-0">
									{items.slice(0, 3).map((a) => {
										const overdue = isOverdue(a, now);
										return (
											<button
												key={a.id}
												type="button"
												data-testid="zoom-pill"
												onClick={(e) => {
													e.stopPropagation();
													onSelect?.(a.id);
													setEditId(a.id);
												}}
												className={cn(
													"text-left text-micro leading-4 rounded px-1 py-0.5 truncate min-h-11 md:min-h-0",
													overdue && "border-l-2 border-amber-500 pill-overdue",
												)}
												style={{ background: `color-mix(in srgb, ${statusColor(a.status)} 18%, transparent)` }}
												title={`${a.user_friendly_name} ${hhmm(a.start_time)}`}
											>
												{tier === 3 ? (
													<span className="block truncate">{a.user_friendly_name}</span>
												) : (
													<span className="block min-w-0">
														<span className="block truncate text-micro text-muted-foreground" aria-hidden="true">
															{(a.engine_name?.trim()?.charAt(0) || "\u2022").toUpperCase()}
														</span>
														<span className="block truncate font-medium [overflow-wrap:anywhere] hyphens-auto">{a.user_friendly_name}</span>
														<span className="block truncate text-micro text-muted-foreground tabular-nums pill-time">
															{hhmm(a.start_time)}
															{a.profile_name ? ` \u00b7 ${a.profile_name.slice(0, 3).toUpperCase()}` : ""}
														</span>
													</span>
												)}
											</button>
										);
									})}
									{total > 3 && (
										<button
											type="button"
											className="text-micro text-muted-foreground text-left px-1 min-h-11 md:min-h-0"
											onClick={(e) => {
												e.stopPropagation();
												openDay(day);
											}}
										>
											+{total - 3} more
										</button>
									)}
								</div>
							)}
						</div>
					);
				})}
			</div>
			<EditSheet
				autorun={autoruns.find((a) => a.id === editId) ?? null}
				onClose={() => {
					setEditId(null);
					queryClient.invalidateQueries({ queryKey: ["autoruns"] });
				}}
				onDuplicate={onDuplicate}
			/>
		</div>
	);
}

function DayFocus({
	day,
	items,
	selectedId,
	onBack,
	onToday,
	onEdit,
}: {
	day: Date;
	items: Autorun[];
	selectedId?: number | null;
	onBack: () => void;
	onToday: () => void;
	onEdit: (id: number) => void;
}) {
	const label = day.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
	return (
		<div className="flex flex-col min-h-0" data-testid="day-focus" data-tier={5}>
			<div className="flex items-center gap-1 px-2 py-2">
				<Button variant="ghost" size="sm" className="h-8" onClick={onBack}>‹ Month</Button>
				<div className="flex-1 text-center text-sm font-semibold">{label}</div>
				<Button variant="outline" size="sm" className="h-8 text-xs" onClick={onToday} id="today-fab">Today</Button>
			</div>
			<div className="flex-1 overflow-y-auto px-2 pb-24">
				{items.length === 0 && (
					<div className="text-sm text-muted-foreground py-8 text-center">No autoruns this day</div>
				)}
				{items.map((a) => {
					const s = parseUtcDate(a.start_time);
					const e = parseUtcDate(a.end_time);
					const dur = s && e && !Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime())
						? Math.max(0, Math.round((e.getTime() - s.getTime()) / 60000))
						: null;
					const top = s ? (s.getHours() * 60 + s.getMinutes()) / 1440 * 100 : 0;
					const height = dur ? Math.max(3, dur / 1440 * 100) : 4;
					return (
						<button
							key={a.id}
							type="button"
							data-testid="day-block"
							onClick={() => onEdit(a.id)}
							className={cn(
								"w-full text-left rounded-lg border p-2 mb-2 min-h-11",
								selectedId === a.id && "ring-1 ring-primary",
							)}
							style={{ borderLeft: `3px solid ${statusColor(a.status)}` }}
						>
							<div className="text-sm font-medium truncate">{a.user_friendly_name}</div>
							<div className="text-micro text-muted-foreground tabular-nums">
								{hhmm(a.start_time)}–{hhmm(a.end_time)}
								{a.profile_name ? ` · ${a.profile_name.slice(0, 3).toUpperCase()}·${a.profile_name}` : ""}
							</div>
							<div className="text-micro text-muted-foreground">
								{a.status ?? "scheduled"} · {dur !== null ? `${Math.floor(dur / 60)}h ${String(dur % 60).padStart(2, "0")}m` : "—"} · —
							</div>
							<div className="text-micro text-muted-foreground tabular-nums">starts at {top.toFixed(1)}% · height {height.toFixed(1)}%</div>
						</button>
					);
				})}
			</div>
		</div>
	);
}

	function EditSheet({
		autorun,
		onClose,
		onDuplicate,
	}: {
		autorun: Autorun | null;
		onClose: () => void;
		onDuplicate?: (a: Autorun) => void;
	}) {
	const queryClient = useQueryClient();
	const [start, setStart] = useState<string>("");
	const [end, setEnd] = useState<string>("");
	const [open, setOpen] = useState(false);

	useEffect(() => {
		if (autorun) {
			setStart(autorun.start_time?.slice(0, 19) ?? "");
			setEnd(autorun.end_time?.slice(0, 19) ?? "");
			setOpen(true);
		} else {
			setOpen(false);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [autorun?.id]);

	if (!autorun) return null;
	const status = autorun.status ?? "scheduled";
	const live = LIVE_STATUSES.has(status);
	const spent = SPENT_STATUSES.has(status);
	const frozen = live || spent;

	const mutation = useMutation({
		mutationFn: (payload: { start_time?: string; end_time?: string }) =>
			autorunsApi.update(autorun.id, payload),
		onSuccess: () => {
			toast.success("Autorun updated");
			queryClient.invalidateQueries({ queryKey: ["autoruns"] });
			onClose();
		},
		onError: (err: Error) => {
			const api = err as ApiError;
			toast.error(api.rule ? `${api.message} [${api.rule}]` : api.message);
		},
	});

	function save(patch: { start_time?: string; end_time?: string }) {
		const payload: { start_time?: string; end_time?: string } = {};
		if (patch.start_time) {
			if (live) {
				toast.error("Start is frozen while live [live-start-frozen]");
				return;
			}
			payload.start_time = toUtcNaive(patch.start_time);
		}
		if (patch.end_time) {
			const endMs = new Date(patch.end_time).getTime();
			if (Number.isNaN(endMs) || endMs <= Date.now()) {
				toast.error("End must be in the future [end-must-be-future]");
				return;
			}
			payload.end_time = toUtcNaive(patch.end_time);
		}
		mutation.mutate(payload);
	}

	function moveTomorrow() {
		const s = parseUtcDate(start);
		if (!s) return;
		const n = new Date(s);
		n.setDate(n.getDate() + 1);
		const iso = n.toISOString().slice(0, 19);
		setStart(iso);
		save({ start_time: iso });
	}

	function plusOneHour() {
		const e = parseUtcDate(end);
		if (!e) return;
		const n = new Date(e.getTime() + 3600_000);
		const iso = n.toISOString().slice(0, 19);
		setEnd(iso);
		save({ end_time: iso });
	}

	function duplicate() {
		if (!autorun) return;
		if (!onDuplicate) {
			toast.success(`Duplicated ${autorun.user_friendly_name ?? "autorun"} — adjust times then create`);
			return;
		}
		onDuplicate(autorun);
		onClose();
	}

	return (
		<Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
			<SheetContent side="bottom" className="pb-[env(safe-area-inset-bottom)] rounded-t-2xl">
				<SheetTitle className="text-sm font-semibold truncate">{autorun.user_friendly_name}</SheetTitle>
				<div className="text-micro text-muted-foreground">{status}{frozen ? " · locked" : ""}</div>
				<div className="mt-3 flex flex-col gap-3">
					<div>
						<div className="text-micro font-medium mb-1">Start{live ? " (frozen while live)" : ""}</div>
						<div className={cn(live || spent ? "pointer-events-none opacity-50" : undefined)} aria-disabled={live || spent}>
							<DateTimePicker value={start} onChange={setStart} />
						</div>
					</div>
					<div>
						<div className="text-micro font-medium mb-1">End (must be &gt; now)</div>
						<div className={cn(spent ? "pointer-events-none opacity-50" : undefined)} aria-disabled={spent}>
							<DateTimePicker value={end} onChange={setEnd} />
						</div>
					</div>
					<div className="flex gap-2">
						<Button variant="outline" size="sm" className="h-11 flex-1" onClick={moveTomorrow} disabled={frozen}>Move tomorrow</Button>
						<Button variant="outline" size="sm" className="h-11 flex-1" onClick={plusOneHour} disabled={spent}>+1h</Button>
						<Button variant="ghost" size="sm" className="h-11 flex-1" onClick={duplicate}>Duplicate</Button>
					</div>
					<Button
						className="h-11"
						disabled={mutation.isPending || spent}
						onClick={() => save({ start_time: start, end_time: end })}
					>
						{mutation.isPending ? "Saving…" : "Save"}
					</Button>
				</div>
			</SheetContent>
		</Sheet>
	);
}
