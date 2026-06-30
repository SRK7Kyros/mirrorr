import { useState, useEffect } from "react";
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

// ── Token expiry helper ─────────────────────────────────────────

function tokenStatus(): "valid" | "expiring" | "expired" | "none" {
    const token = localStorage.getItem("mirrorr_jwt");
    if (!token) return "none";
    try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        const remaining = payload.exp - Math.floor(Date.now() / 1000);
        if (remaining <= 0) return "expired";
        if (remaining < 5 * 60) return "expiring"; // <5 min
        return "valid";
    } catch {
        return "expired";
    }
}

// ── Status indicator for the navbar ─────────────────────────────

export function NetworkStatusDot() {
    const backendStatus = useRequestLogStore((s) => s.backendStatus);
    const lastErrorAt = useRequestLogStore((s) => s.lastErrorAt);
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
    const [showAge, setShowAge] = useState<string | null>(null);
    const [auth, setAuth] = useState(tokenStatus);

    // Poll token status every 30s
    useEffect(() => {
        const id = setInterval(() => setAuth(tokenStatus()), 30_000);
        return () => clearInterval(id);
    }, []);

    useEffect(() => {
        if (!lastErrorAt) {
            setShowAge(null);
            return;
        }
        const tick = () => {
            const secs = Math.floor((Date.now() - lastErrorAt) / 1000);
            setShowAge(
                secs < 60 ? `${secs}s ago` : `${Math.floor(secs / 60)}m ago`,
            );
        };
        tick();
        const id = setInterval(tick, 5000);
        return () => clearInterval(id);
    }, [lastErrorAt]);

    // Color priority: auth issues > backend issues > all good
    const color =
        !isAuthenticated || auth === "expired"
            ? "bg-red-500"
            : auth === "expiring"
              ? "bg-amber-500 animate-pulse"
              : backendStatus === "connected"
                ? "bg-emerald-500"
                : backendStatus === "disconnected"
                  ? "bg-red-500"
                  : "bg-amber-500 animate-pulse";

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
            className="flex items-center gap-1.5 shrink-0 h-7 px-2 rounded-md border border-border/50 bg-muted/30"
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

    // Track backend health by observing API responses
    useEffect(() => {
        const log = useRequestLogStore.getState();
        if (entries.length === 0) return;
        const latest = entries[0];
        if (latest.ok === true) {
            log.setBackendStatus("connected");
        } else if (
            latest.ok === false &&
            latest.status !== 401 &&
            latest.status !== 403
        ) {
            log.setBackendStatus("disconnected");
        }
    }, [entries]);

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
                            backendStatus === "connected"
                                ? "bg-emerald-500"
                                : backendStatus === "disconnected"
                                  ? "bg-red-500"
                                  : "bg-amber-500 animate-pulse",
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
                            <div className="divide-y divide-border/50">
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
    const methodColor =
        {
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
        <div className="group" onClick={onToggle}>
            <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/30 cursor-pointer transition-colors">
                <span className="text-[10px] text-muted-foreground/60 font-mono shrink-0 w-[58px]">
                    {time}
                </span>
                <span
                    className={cn(
                        "text-[10px] font-bold font-mono uppercase w-14 shrink-0",
                        methodColor,
                    )}
                >
                    {entry.method}
                </span>
                <span
                    className={cn(
                        "text-[10px] font-mono w-8 shrink-0",
                        statusColor,
                    )}
                >
                    {entry.status ?? "—"}
                </span>
                <span className="text-[11px] truncate flex-1 min-w-0 text-muted-foreground">
                    {entry.path}
                </span>
                <span className="text-[10px] text-muted-foreground/60 font-mono shrink-0 w-12 text-right">
                    {entry.duration !== null
                        ? entry.duration < 1000
                            ? `${entry.duration}ms`
                            : `${(entry.duration / 1000).toFixed(1)}s`
                        : "—"}
                </span>
                {expanded ? (
                    <ChevronDown className="size-3 shrink-0 text-muted-foreground/40" />
                ) : (
                    <ChevronRight className="size-3 shrink-0 text-muted-foreground/40" />
                )}
            </div>
            {expanded && (
                <div className="px-3 pb-2 pt-1 space-y-2 bg-muted/10 border-t border-border/30">
                    <DetailBlock label="URL" value={entry.url} />
                    {entry.requestBody && (
                        <DetailBlock
                            label="Request Body"
                            value={entry.requestBody}
                            mono
                        />
                    )}
                    {entry.responseBody && (
                        <DetailBlock
                            label="Response"
                            value={entry.responseBody}
                            mono
                        />
                    )}
                    {entry.error && (
                        <DetailBlock label="Error" value={entry.error} />
                    )}
                </div>
            )}
        </div>
    );
}

// ── Detail block ────────────────────────────────────────────────

function DetailBlock({
    label,
    value,
    mono,
}: {
    label: string;
    value: string;
    mono?: boolean;
}) {
    const [hovered, setHovered] = useState(false);
    const [copied, setCopied] = useState(false);

    function handleCopy(e: React.MouseEvent) {
        e.stopPropagation();
        navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
        });
    }

    return (
        <div className="space-y-0.5">
            <p className="text-[9px] text-muted-foreground/60 uppercase tracking-wider">
                {label}
            </p>
            <div
                className={cn(
                    "text-[10px] rounded bg-background/50 px-2 py-1.5 max-h-24 overflow-auto break-all",
                    mono
                        ? "font-mono text-muted-foreground"
                        : "text-foreground",
                )}
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
            >
                <div className="flex items-start gap-1.5">
                    <span className="flex-1 min-w-0 whitespace-pre-wrap">
                        {value}
                    </span>
                    {hovered && (
                        <button
                            className="shrink-0 mt-0.5 p-0.5 rounded hover:bg-muted transition-colors"
                            onClick={handleCopy}
                            title="Copy to clipboard"
                        >
                            {copied ? (
                                <Check className="size-3 text-emerald-500" />
                            ) : (
                                <Copy className="size-3 text-muted-foreground/60" />
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
