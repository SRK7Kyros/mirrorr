/**
 * @module routes/_app/monitoring/index
 *
 * Monitoring dashboard — system overview + per-session telemetry.
 */

import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, Cpu, HardDrive, Radio } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useSessions } from "@/hooks/use-queries";
import { telemetryApi } from "@/lib/api";
import type { Session } from "@/lib/schemas";
import { cn, formatBytes, getStatusDotColor } from "@/lib/utils";

export const Route = createFileRoute("/_app/monitoring/")({
	component: MonitoringPage,
});

function MonitoringPage() {
	const { data: system, isLoading: systemLoading } = useQuery({
		queryKey: ["telemetry-system"],
		queryFn: () => telemetryApi.system(),
		refetchInterval: 5000,
	});

	const { data: sessions = [], isLoading: sessionsLoading } = useSessions();

	const isLoading = systemLoading || sessionsLoading;

	return (
		<div className="h-full p-2 flex flex-col gap-2">
			<div className="grid grid-cols-4 gap-2 shrink-0">
				<SystemCard
					label="Total CPU"
					value={system ? `${system.total_cpu_percent}%` : "—"}
					icon={Cpu}
					color="text-emerald-500"
					bgColor="bg-emerald-500/10"
					loading={systemLoading}
				/>
				<SystemCard
					label="Total Memory"
					value={system ? formatBytes(system.total_memory_bytes) : "—"}
					icon={HardDrive}
					color="text-blue-500"
					bgColor="bg-blue-500/10"
					loading={systemLoading}
				/>
				<SystemCard
					label="Processes"
					value={system ? `${system.total_processes}` : "—"}
					icon={Activity}
					color="text-amber-500"
					bgColor="bg-amber-500/10"
					loading={systemLoading}
				/>
				<SystemCard
					label="Active Sessions"
					value={system ? `${system.active_sessions}` : "—"}
					icon={Radio}
					color="text-violet-500"
					bgColor="bg-violet-500/10"
					loading={systemLoading}
				/>
			</div>

			<div className="flex-1 min-h-0 border rounded-xl bg-card overflow-auto">
				{isLoading ? (
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

function SystemCard({
	label,
	value,
	icon: Icon,
	color,
	bgColor,
	loading,
}: {
	label: string;
	value: string;
	icon: React.ComponentType<{ className?: string }>;
	color: string;
	bgColor: string;
	loading: boolean;
}) {
	return (
		<Card className="p-3 flex items-center gap-3">
			<div
				className={cn(
					"size-8 rounded-lg flex items-center justify-center shrink-0",
					bgColor,
				)}
			>
				<Icon className={cn("size-4", color)} />
			</div>
			<div className="min-w-0">
				<p className="text-xs text-muted-foreground">{label}</p>
				{loading ? (
					<Spinner className="size-3 text-muted-foreground" />
				) : (
					<p className="text-lg font-bold tabular-nums">{value}</p>
				)}
			</div>
		</Card>
	);
}
