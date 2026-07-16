/**
 * @module routes/_app/monitoring/index
 *
 * Monitoring dashboard — system overview + per-session telemetry.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Spinner } from "@/components/ui/spinner";
import { useSessions } from "@/hooks/use-queries";
import type { Session } from "@/lib/schemas";
import { cn, getStatusDotColor } from "@/lib/utils";

export const Route = createFileRoute("/_app/monitoring/")({
	component: MonitoringPage,
});

function MonitoringPage() {
	const { data: sessions = [], isLoading: sessionsLoading } = useSessions();

	return (
		<div className="h-full p-2 flex flex-col gap-2">
			<div className="flex-1 min-h-0 border rounded-xl bg-card overflow-auto">
				{sessionsLoading ? (
					<div className="flex items-center justify-center h-full">
						<Spinner className="size-5 text-muted-foreground" />
					</div>
				) : sessions.length === 0 ? (
					<EmptyState text="No sessions" />
				) : (
					<div className="divide-y">
						{(sessions as Session[]).map((s) => (
							<Link
								key={s.id}
								to="/monitoring/$sessionId"
								params={{ sessionId: String(s.id) }}
								className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
							>
								<div
									className={cn(
										"size-2 rounded-full shrink-0",
										getStatusDotColor(s.status),
									)}
								/>
								<span className="text-sm font-medium">Session #{s.id}</span>
								<StatusBadge status={s.status} />
								{s.session_urls && s.session_urls.length > 0 && (
									<span className="text-[10px] text-muted-foreground truncate ml-auto">
										{s.session_urls[0].label as React.ReactNode}
									</span>
								)}
							</Link>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
