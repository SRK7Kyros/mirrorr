import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { useAutoruns, useRecordings, useSessions } from "@/hooks/use-queries";
import { useInterval } from "@/hooks/use-interval";
import { useRequestLogStore } from "@/stores/request-log-store";
import { AREAS, DASHBOARD_MAIN } from "@/lib/layouts";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn, formatLocalDate, getStatusDotColor } from "@/lib/utils";

export const Route = createFileRoute("/_app/")({
	component: DashboardPage,
});

const DAY_MS = 86_400_000;

function DashboardPage() {
	const isMobile = useIsMobile();
	const { data: sessions = [] } = useSessions();
	const { data: autoruns = [] } = useAutoruns();
	const { data: recordings = [] } = useRecordings();
	const lastWsTs = useRequestLogStore((s) =>
		s.entries.find((e) => e.type === "ws-event"),
	)?.timestamp;
	const [now, setNow] = useState(() => Date.now());
	useInterval(() => setNow(Date.now()), 1000);

	const active = sessions.filter(
		(s) => s.status === "active" || s.status === "recording",
	);
	const nextAutoruns = autoruns
		.filter((a) => {
			if (a.status !== "scheduled" || !a.start_time) return false;
			const ms = new Date(a.start_time).getTime();
			return !Number.isNaN(ms) && ms < now + DAY_MS;
		})
		.sort((a, b) =>
			String(a.start_time).localeCompare(String(b.start_time)),
		)
		.slice(0, 8);
	const failedSessions = sessions.filter((s) => s.status === "failed");
	const failedAutoruns = autoruns.filter((a) => a.status === "failed");
	const failedCount = failedSessions.length + failedAutoruns.length;
	const recentRecordings = recordings.slice(0, 8);
	const updatedLabel =
		lastWsTs == null
			? "no events yet"
			: `${Math.max(0, Math.round((now - lastWsTs) / 1000))}s ago`;

	return (
		<div className="h-full p-2 flex flex-col gap-2">
			<Card className="px-4 py-3 flex items-center gap-4 shrink-0 flex-wrap tabular-nums">
				<span className="text-sm font-semibold">
					<span className="text-emerald-500">●</span> {active.length} LIVE
				</span>
				<span className="text-sm text-muted-foreground">
					○ {nextAutoruns.length} scheduled next 24h
				</span>
				<span className="text-sm text-muted-foreground">
					⚠ {failedCount} failed
				</span>
				<span className="text-micro text-muted-foreground ml-auto">
					Updated {updatedLabel}
				</span>
			</Card>

			<div
				className="flex-1 min-h-0 grid gap-2"
				style={isMobile ? DASHBOARD_MAIN.styleStacked() : DASHBOARD_MAIN.style}
			>
				<Card className="p-3 flex flex-col min-h-0 overflow-auto" style={{ gridArea: AREAS.actions }}>
					<p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-2 shrink-0">
						Live now
					</p>
					{active.length === 0 ? (
						<p className="text-xs text-muted-foreground/70 py-2">
							0 LIVE —{" "}
							<Link to="/sessions" className="underline underline-offset-2">
								Go to Sessions
							</Link>
						</p>
					) : (
						<div className="divide-y rounded-lg overflow-hidden border mb-4">
							{active.map((session) => (
								<Link
									key={session.id}
									to="/sessions"
									className="flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors text-xs"
								>
									<div
										className={cn(
											"size-1.5 rounded-full shrink-0 animate-pulse",
											getStatusDotColor(session.status),
										)}
									/>
									<span className="font-medium truncate">
										{session.autorun_id ? `Autorun ${session.id}` : `Session #${session.id}`}
									</span>
									<StatusBadge status={session.status} className="ml-auto shrink-0" />
								</Link>
							))}
						</div>
					)}

					<p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-2 shrink-0">
						Next 24h
					</p>
					{nextAutoruns.length === 0 ? (
						<p className="text-xs text-muted-foreground/70 py-2">
							0 scheduled —{" "}
							<Link to="/autoruns" className="underline underline-offset-2">
								New autorun
							</Link>
						</p>
					) : (
						<div className="divide-y rounded-lg overflow-hidden border">
							{nextAutoruns.map((a) => (
								<Link
									key={a.id}
									to="/autoruns"
									className="flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors text-xs"
								>
									<div
										className={cn(
											"size-1.5 rounded-full shrink-0",
											getStatusDotColor(a.status ?? "scheduled"),
										)}
									/>
									<span className="font-medium truncate">{a.user_friendly_name}</span>
									<span className="text-muted-foreground ml-auto shrink-0 tabular-nums">
										{a.start_time ? formatLocalDate(a.start_time) : "—"}
									</span>
								</Link>
							))}
						</div>
					)}
				</Card>

				<Card
					className="p-3 flex flex-col min-h-0 overflow-auto"
					style={{ gridArea: AREAS.sessions }}
				>
					<p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-2 shrink-0">
						Recent recordings
					</p>
					{recentRecordings.length === 0 ? (
						<p className="text-xs text-muted-foreground/70 py-2">
							0 recordings —{" "}
							<Link to="/sessions" className="underline underline-offset-2">
								Start a session
							</Link>
						</p>
					) : (
						<div className="divide-y rounded-lg overflow-hidden border mb-4">
							{recentRecordings.map((r) => (
								<Link
									key={r.id}
									to="/recordings"
									className="flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors text-xs"
								>
									<span className="font-medium truncate">{r.user_friendly_name}</span>
									<span className="text-muted-foreground ml-auto shrink-0">
										#{r.id}
									</span>
								</Link>
							))}
						</div>
					)}

					<p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-2 shrink-0">
						Failed
					</p>
					{failedCount === 0 ? (
						<p className="text-xs text-muted-foreground/70 py-2">
							0 failed — nothing needs attention
						</p>
					) : (
						<div className="divide-y rounded-lg overflow-hidden border">
							{failedSessions.map((s) => (
								<Link
									key={`s-${s.id}`}
									to="/sessions"
									className="flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors text-xs"
								>
									<span className="font-medium truncate">Session #{s.id}</span>
									<StatusBadge status={s.status} className="ml-auto shrink-0" />
								</Link>
							))}
							{failedAutoruns.map((a) => (
								<Link
									key={`a-${a.id}`}
									to="/autoruns"
									className="flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors text-xs"
								>
									<span className="font-medium truncate">{a.user_friendly_name}</span>
									<StatusBadge status={a.status ?? "failed"} className="ml-auto shrink-0" />
								</Link>
							))}
						</div>
					)}
				</Card>
			</div>
		</div>
	);
}
