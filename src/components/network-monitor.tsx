import { useState, useEffect, useCallback } from "react"
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard"
import { useInterval } from "@/hooks/use-interval";
import { createPortal } from "react-dom";
import { Rnd } from "react-rnd";
import {
    useRequestLogStore,
    type RequestLogEntry,
} from "@/stores/request-log-store";
import { useAuthStore } from "@/stores/auth-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
    Wifi,
    Minimize2,
    Maximize2,
    X,
    Trash2,
    ChevronDown,
    ChevronRight,
    RefreshCw,
    Copy,
    Check,
} from "lucide-react";
import { tokenStatus } from "@/lib/api";

// ── Backend status color helper ────────────────────────────────

function getBackendStatusColor(status: string): string {
    switch (status) {
        case "connected": return "bg-emerald-500"
        case "disconnected": return "bg-red-500"
        default: return "bg-amber-500 animate-pulse"
    }
}

// ── Status indicator for the navbar ─────────────────────────────

export function NetworkStatusDot() {
    const backendStatus = useRequestLogStore((s) => s.backendStatus);
    const lastErrorAt = useRequestLogStore((s) => s.lastErrorAt);
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
    const token = useAuthStore((s) => s.token);
    const [showAge, setShowAge] = useState<string | null>(null);
    const auth = tokenStatus();

    useInterval(() => {
        if (!lastErrorAt) return;
        const secs = Math.floor((Date.now() - lastErrorAt) / 1000);
        setShowAge(
            secs < 60 ? `${secs}s ago` : `${Math.floor(secs / 60)}m ago`,
        );
    }, lastErrorAt ? 5000 : null)

    // Color priority: auth issues > backend issues > all good
    const color =
        !isAuthenticated || auth === "expired"
            ? "bg-red-500"
            : auth === "expiring"
              ? "bg-amber-500 animate-pulse"
              : getBackendStatusColor(backendStatus);

    const label = (() => {
        if (!isAuthenticated) return "Auth off";
        if (auth === "expired") return "Expired";
        if (auth === "expiring") return "Expiring";
        if (backendStatus === "connected") return "OK";
        if (backendStatus === "disconnected") return "Down";
        return "…";
    })();

    const title = (() => {
        if (!isAuthenticated) return "Not authenticated";
        if (auth === "expired") return "Session expired";
        if (auth === "expiring") return "Session expiring soon (refreshing…)";
        if (backendStatus === "connected") return "Connected · Session valid";
        if (backendStatus === "disconnected")
            return `Disconnected${showAge ? ` (${showAge})` : ""}`;
        return "Checking…";
    })();

    return (
        <span
            className="flex items-center gap-1.5 shrink-0"
            title={title}
        >
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
  const token = useAuthStore((s) => s.token);

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

  // Initial check on mount / token change
  useEffect(() => {
    if (token) check();
  }, [token, check]);

  useInterval(check, token ? 15_000 : null);

  return null;
}

function tryParseJson(str: string): unknown {
    try { return JSON.parse(str); } catch { return str; }
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
    }, [open, defaultPos]);
    useEffect(() => {
        setSize(
            minimized
                ? { width: 420, height: 48 }
                : { width: 420, height: 500 },
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
            minHeight={48}
            bounds="parent"
            dragHandleClassName="drag-handle"
            enableResizing={!minimized}
        >
            <div className="h-full flex flex-col bg-card border rounded-xl shadow-2xl overflow-hidden">
                {/* Header — always visible, draggable */}
                <div className="drag-handle h-10 shrink-0 flex items-center gap-2 px-3 border-b bg-muted/30 cursor-move select-none">
                    <Wifi className="size-3.5 text-muted-foreground" />
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
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
                    >
                        <Trash2 className="size-3" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        className="size-5"
                        onClick={() => setMinimized(!minimized)}
                        title={minimized ? "Expand" : "Minimize"}
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
                    >
                        <X className="size-3" />
                    </Button>
                </div>

                {/* Body */}
                {!minimized && (
                    <ScrollArea className="flex-1 min-h-0">
                        {entries.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                                <RefreshCw className="size-4 mb-1 opacity-30" />
                                <p className="text-[11px]">No requests yet</p>
                            </div>
                        ) : (
                            <div>
                                {/* Header row */}
                                <div className="grid px-3" style={{ gridTemplateColumns: "70px 56px 32px 1fr 48px 40px" }}>
                                    <span className="text-[9px] text-muted-foreground/60 font-mono uppercase py-1">Time</span>
                                    <span className="text-[9px] text-muted-foreground/60 font-mono uppercase py-1">Method</span>
                                    <span className="text-[9px] text-muted-foreground/60 font-mono uppercase py-1">St</span>
                                    <span className="text-[9px] text-muted-foreground/60 font-mono uppercase py-1">Path</span>
                                    <span className="text-[9px] text-muted-foreground/60 font-mono uppercase py-1 text-right">Dur</span>
                                    <span className="py-1" />
                                </div>
                                {entries.map((entry) => (
                                    <RequestRow
                                        key={entry.id}
                                        entry={entry}
                                        expanded={expandedId === entry.id}
                                        onToggle={() =>
                                            setExpandedId(
                                                expandedId === entry.id
                                                    ? null
                                                    : entry.id,
                                            )
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
    const [copiedAll, copyAll] = useCopyToClipboard()
    const methodColor =
        entry.type === "ws-event"
            ? "text-cyan-600 dark:text-cyan-400"
            : entry.type === "ws-notif"
              ? "text-violet-600 dark:text-violet-400"
              : {
                    GET: "text-emerald-600 dark:text-emerald-400",
                    POST: "text-blue-600 dark:text-blue-400",
                    PUT: "text-amber-600 dark:text-amber-400",
                    DELETE: "text-red-600 dark:text-red-400",
                    PATCH: "text-purple-600 dark:text-purple-400",
                }[entry.method] ?? "text-muted-foreground";

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
            <div
                className="grid px-3 cursor-pointer hover:bg-muted/30 transition-colors"
                style={{ gridTemplateColumns: "70px 56px 32px 1fr 48px 40px" }}
                onClick={onToggle}
            >
                <span className="text-[10px] text-muted-foreground/60 font-mono py-1.5 flex items-center">{time}</span>
                <span className={cn("text-[10px] font-bold font-mono uppercase py-1.5 flex items-center", methodColor)}>{entry.method}</span>
                <span className={cn("text-[10px] font-mono py-1.5 flex items-center", statusColor)}>{entry.status ?? "—"}</span>
                <span className="text-[11px] truncate text-muted-foreground py-1.5 flex items-center">{entry.path}</span>
                <span className="text-[10px] text-muted-foreground/60 font-mono text-right py-1.5 flex items-center justify-end">
                    {entry.duration !== null
                        ? entry.duration < 1000
                            ? `${entry.duration}ms`
                            : `${(entry.duration / 1000).toFixed(1)}s`
                        : "—"}
                </span>
                <span className="py-1.5 flex items-center justify-center gap-0.5">
                    <span
                        className="p-0.5 rounded hover:bg-muted/50 transition-colors"
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
                            if (entry.requestBody) obj.requestBody = tryParseJson(entry.requestBody);
                            if (entry.responseBody) obj.responseBody = tryParseJson(entry.responseBody);
                            if (entry.error) obj.error = entry.error;
                            copyAll(JSON.stringify(obj, null, 2));
                        }}
                    >
                        {copiedAll
                            ? <Check className="size-3 text-emerald-500" />
                            : <Copy className="size-3 text-muted-foreground/40" />}
                    </span>
                    {expanded
                        ? <ChevronDown className="size-3 text-muted-foreground/40" />
                        : <ChevronRight className="size-3 text-muted-foreground/40" />}
                </span>
            </div>
            {/* Expanded details — card layout */}
            {expanded && (
                <div className="px-2 pb-2 pt-1 space-y-1.5 bg-muted/15 border-t border-border/35">
                    <DetailCard label="URL" value={entry.url} />
                    {entry.requestBody && <DetailCard label="Request Body" value={entry.requestBody} mono />}
                    {entry.responseBody && <DetailCard label="Response" value={entry.responseBody} mono />}
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
            if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && Object.keys(parsed).length > 2) {
                return JSON.stringify(parsed, null, 2);
            }
            if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "object" && parsed[0] !== null && Object.keys(parsed[0]).length > 2) {
                return JSON.stringify(parsed, null, 2);
            }
        } catch { /* not JSON */ }
        return value;
    })();

    return (
        <>
            <div className="rounded-md border border-border/60 bg-muted/30 overflow-hidden">
                {/* Card header */}
                <div className="flex items-center gap-1 px-2 py-1 border-b border-border/40 bg-muted/20">
                    <span className="text-[9px] text-muted-foreground/70 uppercase tracking-wider flex-1">
                        {label}
                    </span>
                    <button
                        className="p-0.5 rounded hover:bg-muted transition-colors"
                        onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
                        title="Expand"
                    >
                        <Maximize2 className="size-3 text-muted-foreground/50" />
                    </button>
                    <button
                        className="p-0.5 rounded hover:bg-muted transition-colors"
                        onClick={(e) => { e.stopPropagation(); copy(value); }}
                        title="Copy to clipboard"
                    >
                        {copied
                            ? <Check className="size-3 text-emerald-500" />
                            : <Copy className="size-3 text-muted-foreground/50" />}
                    </button>
                </div>
                {/* Card content */}
                <div
                    className={cn(
                        "text-[10px] px-2 py-1.5 max-h-32 overflow-x-auto overflow-y-auto break-words scrollbar-thin",
                        mono
                            ? "font-mono text-muted-foreground"
                            : "text-foreground",
                    )}
                >
                    <span className="whitespace-pre">{displayValue}</span>
                </div>
            </div>

            {/* Fullscreen panel — portaled to body to escape Rnd's transform */}
            {expanded && createPortal(
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
                    onClick={() => setExpanded(false)}
                >
                    <div
                        className="bg-card border rounded-lg shadow-xl w-[90vw] max-w-3xl h-[80vh] flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0">
                            <h3 className="text-xs font-semibold">{label}</h3>
                            <div className="flex items-center gap-2">
                                <button
                                    className="p-1 rounded hover:bg-muted transition-colors"
                                    onClick={(e) => { e.stopPropagation(); copy(value); }}
                                    title="Copy to clipboard"
                                >
                                    {copied
                                        ? <Check className="size-3.5 text-emerald-500" />
                                        : <Copy className="size-3.5 text-muted-foreground" />}
                                </button>
                                <button
                                    className="text-xs text-muted-foreground hover:text-foreground"
                                    onClick={() => setExpanded(false)}
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                        <ScrollArea className="flex-1 min-h-0">
                            <pre className={cn(
                                "p-4 text-[11px] leading-relaxed whitespace-pre",
                                mono
                                    ? "font-mono text-muted-foreground"
                                    : "text-foreground",
                            )}>
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
