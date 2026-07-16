/**
 * @module routes/_app/monitoring/$sessionId
 *
 * Per-session telemetry detail page.
 * Shows historical CPU%, memory, and process count charts for a session.
 */

import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { sessionsApi } from "@/lib/api";
import type { Session } from "@/lib/schemas";
import { AREAS, MONITORING_SESSION } from "@/lib/layouts";
import { formatDuration } from "@/lib/utils";

export const Route = createFileRoute("/_app/monitoring/$sessionId")({
	component: SessionTelemetryPage,
});

/** Live-updating duration display. Avoids Date.now() during render. */
function LiveDuration({ startedAt, endedAt }: { startedAt: string; endedAt?: string | null }) {
	const [elapsed, setElapsed] = useState(() => {
		const end = endedAt ? new Date(endedAt).getTime() : Date.now();
		return (end - new Date(startedAt).getTime()) / 1000;
	});

	useEffect(() => {
		if (endedAt) return; // Session ended — no need to tick
		const tick = () =>
			setElapsed((Date.now() - new Date(startedAt).getTime()) / 1000);
		tick();
		const id = setInterval(tick, 1000);
		return () => clearInterval(id);
	}, [startedAt, endedAt]);

	return <span>Duration: {formatDuration(elapsed)}</span>;
}

function SessionTelemetryPage() {
	const { sessionId } = Route.useParams();
	const sessionIdNum = parseInt(sessionId, 10);

	const { data: session, isLoading: sessionLoading } = useQuery({
		queryKey: ["sessions", sessionIdNum],
		queryFn: () => sessionsApi.get(sessionIdNum),
	});

	if (sessionLoading) {
		return (
			<div className="flex items-center justify-center h-full">
				<Spinner className="size-5 text-muted-foreground" />
			</div>
		);
	}

	if (!session) {
		return (
			<div className="flex flex-col items-center justify-center h-full gap-3">
				<p className="text-sm text-muted-foreground">Session not found</p>
				<Link to="/monitoring">
					<Button variant="outline" size="sm" className="h-7 text-xs">
						<ArrowLeft className="size-3 mr-1" />
						Back
					</Button>
				</Link>
			</div>
		);
	}

	const sessionData = session as Session;

	return (
		<div className="h-full grid" style={MONITORING_SESSION.style}>
			<div
				className="shrink-0 px-5 pt-5 pb-3 border-b"
				style={{ gridArea: AREAS.header }}
			>
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-3">
						<Link to="/monitoring">
							<Button variant="ghost" size="sm" className="h-6 text-xs">
								<ArrowLeft className="size-3 mr-0.5" />
								Back
							</Button>
						</Link>
						<h2 className="text-sm font-bold">
							Session #{sessionData.id}
						</h2>
						<StatusBadge status={sessionData.status} />
					</div>
					<div className="flex items-center gap-3 text-xs text-muted-foreground">
						{sessionData.started_at && (
						<LiveDuration
							startedAt={sessionData.started_at}
							endedAt={sessionData.ended_at}
						/>
						)}
						<span>{sessionData.session_urls?.length ?? 0} URLs</span>
					</div>
				</div>
			</div>

			<div
				className="flex-1 min-h-0 overflow-y-auto px-5 py-4"
				style={{ gridArea: AREAS.charts }}
			>
				{sessionLoading ? (
					<div className="flex items-center justify-center h-full">
						<Spinner className="size-5 text-muted-foreground" />
					</div>
				) : (
					<div className="flex flex-col items-center justify-center h-full text-xs text-muted-foreground gap-2">
						<p>Session detail</p>
						<p className="text-muted-foreground/60">
							Telemetry coming soon
						</p>
					</div>
				)}
			</div>
		</div>
	);
}
