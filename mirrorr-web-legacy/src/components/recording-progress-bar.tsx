import { useEffect, useState } from "react";
import { sessionsApi } from "@/lib/api";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Loader2, ExternalLink, Copy, Check } from "lucide-react";
import { formatDuration } from "@/lib/utils";
import { useRemuxProgressStore } from "@/stores/remux-progress-store";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { useRecordings } from "@/hooks/use-queries";

const PROGRESS_POLL_MS = 5000;
const WS_FALLBACK_MS = 10_000;

export function RecordingProgressBar({
	sessionId,
	status,
	className,
}: {
	sessionId: number;
	status: string;
	className?: string;
}) {
	const wsProgress = useRemuxProgressStore((s) => s.bySession[sessionId] ?? null);
	const [polled, setPolled] = useState<{
		percent: number;
		speed?: number;
		eta_seconds?: number | null;
	} | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [now, setNow] = useState(() => Date.now());
	const [copied, copy] = useCopyToClipboard();
	const { data: recordings = [] } = useRecordings();

	const isActive = status === "remuxing" || status === "finalizing";
	const isDone =
		status === "completed" || status === "failed" || status === "terminating";

	useEffect(() => {
		if (!isActive) return;
		const id = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(id);
	}, [isActive]);

	useEffect(() => {
		if (isDone) return;
		if (wsProgress) return;
		let cancelled = false;
		const poll = async () => {
			if (cancelled) return;
			try {
				const res = await sessionsApi.recordingProgress(sessionId);
				if (cancelled) return;
				if (res.progress) {
					setPolled({
						percent: res.progress.percent,
						speed: res.progress.speed,
						eta_seconds: res.progress.eta_seconds,
					});
				}
				setError(null);
			} catch (e) {
				if (!cancelled) setError(e instanceof Error ? e.message : String(e));
			}
		};
		poll();
		const id = setInterval(poll, PROGRESS_POLL_MS);
		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, [sessionId, isDone, wsProgress]);

	if (isDone) {
		// After recording.created the linked recording offers an "Open recording"
		// CTA with copy-link fallback (progress itself is finished).
		const doneLinked = recordings.find((r) => r.session_id === sessionId);
		if (!doneLinked) return null;
		return (
			<div className={`flex items-center gap-2 pt-0.5 ${className ?? ""}`}>
				<Button
					variant="outline"
					size="sm"
					className="h-6 text-micro"
					onClick={() => window.open(doneLinked.content_url, "_blank", "noopener")}
				>
					<ExternalLink className="size-3 mr-1" />
					Open recording
				</Button>
				<Button
					variant="ghost"
					size="sm"
					className="h-6 text-micro"
					onClick={() => copy(doneLinked.content_url)}
				>
					{copied ? (
						<Check className="size-3 mr-1" />
					) : (
						<Copy className="size-3 mr-1" />
					)}
					{copied ? "Copied" : "Copy link"}
				</Button>
			</div>
		);
	}

	const pct = wsProgress?.percent ?? polled?.percent ?? null;
	const speed = wsProgress?.speed ?? polled?.speed;
	const eta = wsProgress?.eta_seconds ?? polled?.eta_seconds;
	const wsAge = wsProgress ? now - wsProgress.receivedAt : null;
	const wsStale = wsAge != null && wsAge > WS_FALLBACK_MS;
	const showDeterminate = pct != null && !(wsStale && polled == null);

	if (!isActive && pct == null && !error) return null;

	const linked = recordings.find((r) => r.session_id === sessionId);

	return (
		<div className={`space-y-1.5 ${className ?? ""}`}>
			<div className="flex items-center justify-between gap-2">
				<Label className="text-xs text-amber-500">
					{error && pct == null ? (
						<span className="text-red-500">Progress unavailable</span>
					) : showDeterminate ? (
						<span>
							Remuxing… {(pct ?? 0).toFixed(0)}%
							{wsStale && (
								<span className="text-muted-foreground"> (stale)</span>
							)}
						</span>
					) : (
						<span className="flex items-center gap-1.5">
							<Loader2 className="size-3 animate-spin" />
							Remuxing…
						</span>
					)}
				</Label>
				<div className="flex items-center gap-2 text-[10px] text-muted-foreground tabular-nums">
					{speed != null && speed > 0 && <span>{speed.toFixed(2)}×</span>}
					{eta != null && <span>ETA {formatDuration(eta)}</span>}
				</div>
			</div>
			{showDeterminate ? (
				<Progress value={pct ?? 0} className="h-2" />
			) : (
				<div
					role="progressbar"
					aria-label="Remuxing in progress"
					className="h-2 w-full overflow-hidden rounded-full bg-muted"
				>
					<div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
				</div>
			)}
			{linked && (
				<div className="flex items-center gap-2 pt-0.5">
					<Button
						variant="outline"
						size="sm"
						className="h-6 text-micro"
						onClick={() => window.open(linked.content_url, "_blank", "noopener")}
					>
						<ExternalLink className="size-3 mr-1" />
						Open recording
					</Button>
					<Button
						variant="ghost"
						size="sm"
						className="h-6 text-micro"
						onClick={() => copy(linked.content_url)}
					>
						{copied ? (
							<Check className="size-3 mr-1" />
						) : (
							<Copy className="size-3 mr-1" />
						)}
						{copied ? "Copied" : "Copy link"}
					</Button>
				</div>
			)}
		</div>
	);
}
