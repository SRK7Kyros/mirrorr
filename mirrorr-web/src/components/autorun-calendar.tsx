import { useMemo, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import type {
	AllowFunc,
	DateSelectArg,
	EventDropArg,
	EventInput,
} from "@fullcalendar/core";
import type { EventResizeDoneArg } from "@fullcalendar/interaction";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { autorunsApi, ApiError } from "@/lib/api";
import type { Autorun } from "@/lib/schemas";
import { parseUtcDate, toUtcNaive } from "@/lib/utils";

const VIEW_KEY = "mirrorr.autoruns.view";
const CAL_VIEW_KEY = "mirrorr.autoruns.calView";
const ZOOM_KEY = "mirrorr.autoruns.zoom";

const ZOOMS = [60, 30, 15, 5];

const TEARDOWN = new Set(["terminating", "remuxing", "finalizing"]);
const SPENT = new Set(["completed", "failed"]);
const LIVE = new Set(["active", "recording"]);

function statusOf(a: Autorun): string {
	return (a.status ?? "scheduled").toLowerCase();
}

function isOverdue(a: Autorun, now: number): boolean {
	if (statusOf(a) !== "scheduled") return false;
	const s = parseUtcDate(a.start_time);
	return !!s && s.getTime() < now;
}

function eventEditable(a: Autorun, now: number): { start: boolean; duration: boolean; why: string } {
	const s = statusOf(a);
	if (TEARDOWN.has(s)) return { start: false, duration: false, why: "Frozen while tearing down" };
	if (SPENT.has(s)) return { start: false, duration: false, why: "History is immutable — duplicate to re-run" };
	if (LIVE.has(s)) return { start: false, duration: true, why: "Start is frozen while live — end can move" };
	if (isOverdue(a, now)) return { start: true, duration: true, why: "Overdue — start must move to the future" };
	const start = parseUtcDate(a.start_time);
	if (start && start.getTime() >= now) return { start: true, duration: true, why: "" };
	return { start: false, duration: false, why: "Past drops are not allowed" };
}

export function AutorunCalendar({
	autoruns,
	onSelect,
	onCreateSlot,
}: {
	autoruns: Autorun[];
	onSelect: (id: number) => void;
	onCreateSlot?: (start: string, end: string) => void;
}) {
	const queryClient = useQueryClient();
	const [calView, setCalView] = useState(
		() => localStorage.getItem(CAL_VIEW_KEY) ?? "timeGridWeek",
	);
	const [zoomIdx, setZoomIdx] = useState(() => {
		const raw = Number(localStorage.getItem(ZOOM_KEY) ?? "1");
		return Number.isInteger(raw) && raw >= 0 && raw < ZOOMS.length ? raw : 1;
	});
	const slotDuration = useMemo(() => {
		const min = ZOOMS[zoomIdx] ?? 30;
		return `00:${String(min).padStart(2, "0")}:00`;
	}, [zoomIdx]);

	const updateMutation = useMutation({
		mutationFn: ({ id, start, end }: { id: number; start: string; end: string }) =>
			autorunsApi.update(id, { start_time: start, end_time: end }),
		onSuccess: (updated, vars) => {
			queryClient.setQueryData<Autorun[]>(["autoruns"], (prev) =>
				prev ? prev.map((a) => (a.id === vars.id ? updated : a)) : prev,
			);
			const s = parseUtcDate(updated.start_time);
			const e = parseUtcDate(updated.end_time);
			const fmt = (d: Date | null) =>
				d ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "?";
			toast.success(`Autorun moved ${fmt(s)}→${fmt(e)}`);
		},
		onError: (err: Error, vars) => {
			queryClient.invalidateQueries({ queryKey: ["autoruns"] });
			const api = err instanceof ApiError ? err : null;
			toast.error(api?.rule ? `${api.message} [${api.rule}]` : err.message);
			void vars;
		},
	});

	const events: EventInput[] = useMemo(() => {
		const now = Date.now();
		const sched = autoruns
			.filter((a) => statusOf(a) === "scheduled")
			.map((a) => ({
				id: a.id,
				s: parseUtcDate(a.start_time)?.getTime() ?? NaN,
				e: parseUtcDate(a.end_time)?.getTime() ?? NaN,
			}))
			.filter((x) => Number.isFinite(x.s) && Number.isFinite(x.e));
		const collides = new Set<number>();
		for (let i = 0; i < sched.length; i++) {
			for (let j = i + 1; j < sched.length; j++) {
				const x = sched[i]!;
				const y = sched[j]!;
				if (x.s < y.e && y.s < x.e) {
					collides.add(x.id);
					collides.add(y.id);
				}
			}
		}
		return autoruns.map((a) => {
			const edit = eventEditable(a, now);
			const s = statusOf(a);
			const classNames = ["fc-autorun"];
			if (LIVE.has(s)) classNames.push("fc-live");
			if (SPENT.has(s)) classNames.push("fc-spent");
			if (TEARDOWN.has(s)) classNames.push("fc-teardown");
			if (collides.has(a.id)) classNames.push("fc-collide");
			return {
				id: String(a.id),
				title: a.user_friendly_name,
				start: a.start_time ? (parseUtcDate(a.start_time) ?? undefined) : undefined,
				end: a.end_time ? (parseUtcDate(a.end_time) ?? undefined) : undefined,
				classNames,
				startEditable: edit.start,
				durationEditable: edit.duration,
				extendedProps: { status: s, why: edit.why, profile: a.profile_name ?? "" },
			};
		});
	}, [autoruns]);

	const allow: AllowFunc = (span, movingEvent): boolean => {
		const movingId = movingEvent ? String(movingEvent.id) : null;
		const a = movingId ? autoruns.find((x) => String(x.id) === movingId) : undefined;
		if (!a) return false;
		const now = Date.now();
		const edit = eventEditable(a, now);
		const anchor = movingEvent?.start ? new Date(movingEvent.start).getTime() : null;
		const isResize = anchor != null && span.start.getTime() === anchor;
		if (isResize ? !edit.duration : !edit.start) return false;
		if (span.end.getTime() <= span.start.getTime()) return false;
		if (span.start.getTime() < now - 60_000 && statusOf(a) === "scheduled" && !isOverdue(a, now)) return false;
		const s = statusOf(a);
		if (LIVE.has(s) && span.end.getTime() <= now) return false;
		if (statusOf(a) === "scheduled" && isOverdue(a, now) && span.start.getTime() < now) return false;
		return true;
	};

	const handleDrop = (arg: EventDropArg) => {
		const id = Number(arg.event.id);
		if (!Number.isFinite(id)) { arg.revert(); return; }
		if (LIVE.has(String(arg.event.extendedProps.status ?? "").toLowerCase())) {
			const end = arg.event.end;
			if (end && end.getTime() <= Date.now()) {
				const ok = window.confirm(
					"Shortening a live autorun to the past stops it on the next scheduler tick (~20s). Continue?",
				);
				if (!ok) { arg.revert(); return; }
			}
		}
		updateMutation.mutate(
			{
				id,
				start: toUtcNaive(arg.event.start ?? new Date()),
				end: toUtcNaive(arg.event.end ?? new Date()),
			},
			{ onError: () => arg.revert() },
		);
	};

	const handleResize = (arg: EventResizeDoneArg) => {
		const id = Number(arg.event.id);
		if (!Number.isFinite(id)) { arg.revert(); return; }
		updateMutation.mutate(
			{
				id,
				start: toUtcNaive(arg.event.start ?? new Date()),
				end: toUtcNaive(arg.event.end ?? new Date()),
			},
			{ onError: () => arg.revert() },
		);
	};

	const handleSelect = (sel: DateSelectArg) => {
		if (!onCreateSlot) return;
		onCreateSlot(toUtcNaive(sel.start), toUtcNaive(sel.end));
	};

	return (
		<div className="flex flex-col min-h-0">
			<div className="flex items-center gap-2 px-2 py-1.5 shrink-0">
				<div className="flex gap-1 text-xs">
					{(["dayGridMonth", "timeGridWeek", "timeGridDay", "listWeek"] as const).map((v) => (
						<button
							key={v}
							type="button"
							onClick={() => {
								setCalView(v);
								localStorage.setItem(CAL_VIEW_KEY, v);
							}}
							className={`h-7 px-2 rounded-md border ${calView === v ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
						>
							{v === "dayGridMonth" ? "Month" : v === "timeGridWeek" ? "Week" : v === "timeGridDay" ? "Day" : "List"}
						</button>
					))}
				</div>
				<div className="flex-1" />
				<div className="flex items-center gap-1 text-xs text-muted-foreground">
					<span>Zoom</span>
					<button
						type="button"
						className="h-7 w-7 rounded-md border"
						onClick={() => {
							const next = Math.max(0, zoomIdx - 1);
							setZoomIdx(next);
							localStorage.setItem(ZOOM_KEY, String(next));
						}}
					>
						−
					</button>
					<span className="tabular-nums w-12 text-center">{ZOOMS[zoomIdx]}m</span>
					<button
						type="button"
						className="h-7 w-7 rounded-md border"
						onClick={() => {
							const next = Math.min(ZOOMS.length - 1, zoomIdx + 1);
							setZoomIdx(next);
							localStorage.setItem(ZOOM_KEY, String(next));
						}}
					>
						+
					</button>
				</div>
			</div>
			<div className="flex-1 min-h-0 px-2 pb-2 fc-mirrorr">
				<FullCalendar
					key={`${calView}-${slotDuration}`}
					plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
					initialView={calView}
					headerToolbar={false}
					height="100%"
					events={events}
					dayMaxEvents
					slotDuration={slotDuration}
					selectable
					select={handleSelect}
					editable={false}
					eventStartEditable
					eventDurationEditable
					eventAllow={allow}
					eventDrop={handleDrop}
					eventResize={handleResize}
					eventClick={(arg) => {
						arg.jsEvent.preventDefault();
						onSelect(Number(arg.event.id));
					}}
					eventDidMount={(arg) => {
						const why = arg.event.extendedProps.why as string | undefined;
						if (why) arg.el.setAttribute("title", why);
						const profile = String(arg.event.extendedProps.profile ?? "");
						if (profile) {
							let h = 0;
							for (let i = 0; i < profile.length; i++) h = (h * 31 + profile.charCodeAt(i)) >>> 0;
							arg.el.style.borderLeft = `3px solid hsl(${h % 360} 70% 50%)`;
						}
					}}
				/>
			</div>
		</div>
	);
}

export { VIEW_KEY };
