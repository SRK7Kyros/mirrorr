import { useCallback, useEffect, useRef, useState } from "react";
import { sessionsApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Terminal, Trash2 } from "lucide-react";

const LOG_POLL_MS = 1000;

/**
 * Live tail of a session's process output logs. Polls
 * `GET /sessions/{id}/logs` incrementally (offset-based) while the session
 * is active, then does a final full read when it ends. Auto-scrolls to the
 * bottom unless the user scrolled up.
 */
export function SessionLogsViewer({
	sessionId,
	active,
	stream = "stdout",
	className,
}: {
	sessionId: number;
	active: boolean;
	stream?: "stdout" | "stderr";
	className?: string;
}) {
	const [lines, setLines] = useState<string[]>([]);
	const [offset, setOffset] = useState(0);
	const [name, setName] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [stickBottom, setStickBottom] = useState(true);
	const [showStream, setShowStream] = useState<"stdout" | "stderr">(stream);
	const scrollRef = useRef<HTMLDivElement>(null);

	const poll = useCallback(async () => {
		setError(null);
		try {
			const res = await sessionsApi.logs(sessionId, {
				stream: showStream,
				name: name || undefined,
				offset,
				limit: 500,
			});
			if (res.name) setName(res.name);
			setLines((prev) => [...prev, ...res.lines]);
			setOffset(res.next_offset);
			if (res.eof && !active) {
				// Final page — stop polling.
			}
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	}, [sessionId, showStream, name, offset, active]);

	useEffect(() => {
		let cancelled = false;
		// Reset when the target session/stream changes
		setLines([]);
		setOffset(0);
		setName("");
		if (!active) {
			// Do a single full read for completed sessions.
			(async () => {
				setLoading(true);
				try {
					const res = await sessionsApi.logs(sessionId, {
						stream: showStream,
						limit: 5000,
					});
					if (cancelled) return;
					if (res.name) setName(res.name);
					setLines(res.lines);
					setOffset(res.next_offset);
				} catch (e) {
					if (!cancelled) setError(e instanceof Error ? e.message : String(e));
				} finally {
					if (!cancelled) setLoading(false);
				}
			})();
			return () => {
				cancelled = true;
			};
		}
		const id = setInterval(poll, LOG_POLL_MS);
		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, [sessionId, showStream, active, poll]);

	// Auto-stick to bottom on new lines unless user scrolled up
	useEffect(() => {
		const el = scrollRef.current;
		if (el && stickBottom) {
			el.scrollTop = el.scrollHeight;
		}
	}, [lines, stickBottom]);

	const onScroll = () => {
		const el = scrollRef.current;
		if (!el) return;
		const nearBottom =
			el.scrollHeight - el.scrollTop - el.clientHeight < 40;
		setStickBottom(nearBottom);
	};

	const clearLogs = () => {
		setLines([]);
		setOffset(0);
	};

	return (
		<div className={`space-y-2 ${className ?? ""}`}>
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-1.5">
					<Terminal className="size-3.5 text-muted-foreground" />
					<Label className="text-xs text-muted-foreground">
						Process output{name ? ` — ${name}` : ""}
					</Label>
					{active && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
				</div>
				<div className="flex items-center gap-1.5">
					<div className="border rounded-md flex">
						{["stdout", "stderr"].map((s) => (
							<button
								key={s}
								type="button"
								onClick={() => {
									setShowStream(s as "stdout" | "stderr");
									setLines([]);
									setOffset(0);
								}}
								className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
									showStream === s
										? "bg-foreground/10 text-foreground"
										: "text-muted-foreground hover:text-foreground"
								}`}
							>
								{s}
							</button>
						))}
					</div>
					<Button
						variant="ghost"
						size="icon"
						className="h-5 w-5 text-muted-foreground"
						title="Clear output"
						onClick={clearLogs}
					>
						<Trash2 className="size-3" />
					</Button>
				</div>
			</div>
			<div className="border rounded-lg bg-muted/30 overflow-hidden">
				<ScrollArea
					ref={scrollRef}
					onScroll={onScroll}
					className="h-48 w-full font-mono text-[11px] leading-4 p-2"
				>
					{loading && lines.length === 0 ? (
						<div className="flex items-center gap-2 text-muted-foreground">
							<Loader2 className="size-3 animate-spin" />
							Loading…
						</div>
					) : lines.length === 0 ? (
						<div className="flex items-center gap-2 text-muted-foreground/60">
							{(active || loading) && <Loader2 className="size-3 animate-spin" />}
							{error ? error : "No output yet"}
						</div>
					) : (
						<pre className="whitespace-pre-wrap break-words">{lines.join("\n")}</pre>
					)}
				</ScrollArea>
			</div>
			{!stickBottom && (
				<div className="text-right">
					<Button
						variant="ghost"
						size="sm"
						className="h-5 text-[10px] text-muted-foreground"
						onClick={() => setStickBottom(true)}
					>
						Jump to latest
					</Button>
				</div>
			)}
		</div>
	);
}