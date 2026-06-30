import { useState, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { Rnd } from "react-rnd";
import {
    useRequestLogStore,
    type RequestLogEntry,
} from "@/stores/request-log-store";
import { useAuthStore } from "@/stores/auth-store";
import { cn } from "@/lib/utils";
import {
    Wifi,
    Shield,
    ShieldOff,
    Maximize2,
    Minimize2,
    X,
    Trash2,
    Search,
    Copy,
    Check,
    Terminal,
} from "lucide-react";

// ── Helpers ────────────────────────────────────────────────────

const statusColor: Record<string, string> = {
    connected: "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]",
    disconnected: "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]",
    checking:
        "bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.5)] animate-pulse",
};

const statusLabel: Record<string, string> = {
    connected: "Backend connected",
    disconnected: "Backend unreachable",
    checking: "Checking…",
};

function methodColor(m: string) {
    if (m === "GET") return "text-sky-400";
    if (m === "POST") return "text-emerald-400";
    if (m === "PUT") return "text-amber-400";
    if (m === "DELETE") return "text-red-400";
    return "text-muted-foreground";
}

function statusColorClass(s: number | null) {
    if (s == null) return "text-amber-400";
    if (s < 300) return "text-emerald-400";
    if (s < 400) return "text-sky-400";
    if (s < 500) return "text-amber-400";
    return "text-red-400";
}

// ── Copy button ────────────────────────────────────────────────

function CopyBtn({ text }: { text: string }) {
    const [ok, setOk] = useState(false);
    return (
        <button
            onClick={() =>
                navigator.clipboard.writeText(text).then(() => {
                    setOk(true);
                    setTimeout(() => setOk(false), 1500);
                })
            }
            className="text-muted-foreground/50 hover:text-foreground transition-colors"
            title="Copy"
        >
            {ok ? <Check className="size-3" /> : <Copy className="size-3" />}
        </button>
    );
}

// ── Code block with label ──────────────────────────────────────

function CodeBlock({
    label,
    text,
    color,
    error,
}: {
    label: string;
    text: string;
    color: string;
    error?: boolean;
}) {
    return (
        <div className="space-y-1">
            <div className="flex items-center gap-2 text-muted-foreground/50">
                <span className="uppercase tracking-wider">{label}</span>
                <CopyBtn text={text} />
            </div>
            <pre
                className={cn(
                    "whitespace-pre-wrap break-all rounded px-2 py-1 max-h-40 overflow-auto text-[10px]",
                    color,
                    error ? "bg-red-500/5" : "bg-white/[0.02]",
                )}
            >
                {text}
            </pre>
        </div>
    );
}

// ── Log entry row ──────────────────────────────────────────────

function LogEntryRow({ entry }: { entry: RequestLogEntry }) {
    const [open, setOpen] = useState(false);
    return (
        <div className="border-b border-white/5 last:border-0">
            <button
                onClick={() => setOpen(!open)}
                className="w-full text-left px-3 py-1.5 hover:bg-white/5 transition-colors flex items-center gap-2 font-mono text-[11px] leading-5"
            >
                <span className="text-muted-foreground/40 shrink-0 w-16 text-right tabular-nums">
                    {new Date(entry.timestamp).toLocaleTimeString("en-GB", {
                        hour12: false,
                    })}
                </span>
                <span
                    className={cn(
                        "shrink-0 font-semibold w-14",
                        methodColor(entry.method),
                    )}
                >
                    {entry.method}
                </span>
                <span
                    className="text-muted-foreground/70 truncate flex-1 min-w-0"
                    title={entry.url}
                >
                    {entry.path}
                </span>
                <span
                    className={cn(
                        "shrink-0 font-semibold tabular-nums",
                        statusColorClass(entry.status),
                    )}
                >
                    {entry.status ?? "…"}
                </span>
                {entry.duration != null && (
                    <span className="shrink-0 text-muted-foreground/40 tabular-nums w-14 text-right">
                        {entry.duration}ms
                    </span>
                )}
                {entry.error && (
                    <span
                        className="shrink-0 text-red-400/70 truncate max-w-[120px]"
                        title={entry.error}
                    >
                        {entry.error}
                    </span>
                )}
            </button>
            {open && (
                <div className="px-3 pb-2 pt-0.5 space-y-2 font-mono">
                    <CodeBlock
                        label="URL"
                        text={entry.url}
                        color="text-muted-foreground/70"
                    />
                    {entry.requestBody && (
                        <CodeBlock
                            label="Request"
                            text={entry.requestBody}
                            color="text-sky-300/60"
                        />
                    )}
                    {entry.responseBody && (
                        <CodeBlock
                            label="Response"
                            text={entry.responseBody}
                            color="text-emerald-300/60"
                        />
                    )}
                    {entry.error && (
                        <CodeBlock
                            label="Error"
                            text={entry.error}
                            color="text-red-400/70"
                            error
                        />
                    )}
                </div>
            )}
        </div>
    );
}

// ── Main widget ────────────────────────────────────────────────

export function StatusWidget() {
    const backendStatus = useRequestLogStore((s) => s.backendStatus);
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
    const entries = useRequestLogStore((s) => s.entries);
    const clear = useRequestLogStore((s) => s.clear);

    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState({ x: 0, y: 0 });
    const [sz, setSz] = useState({ w: 500, h: 360 });
    const [inited, setInited] = useState(false);
    const [filter, setFilter] = useState("");
    const [fs, setFs] = useState(false);

    // Init position on first open
    useEffect(() => {
        if (open && !inited) {
            setPos({ x: Math.max(12, window.innerWidth - 500 - 12), y: 56 });
            setInited(true);
        }
    }, [open, inited]);

    // Escape
    useEffect(() => {
        if (!open) return;
        const h = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                if (fs) setFs(false);
                else setOpen(false);
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [open, fs]);

    // Filter entries
    const filtered = useMemo(() => {
        if (!filter) return entries;
        const q = filter.toLowerCase();
        return entries.filter(
            (e) =>
                e.method.toLowerCase().includes(q) ||
                e.path.toLowerCase().includes(q) ||
                e.url.toLowerCase().includes(q) ||
                (e.error?.toLowerCase().includes(q) ?? false),
        );
    }, [entries, filter]);

    const close = useCallback(() => {
        setOpen(false);
        setFs(false);
    }, []);

    // Panel content (shared between floating and fullscreen)
    const panelContent = (
        <div className="flex flex-col h-full bg-background/95 backdrop-blur-xl border rounded-xl shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="panel-drag-handle shrink-0 px-3 py-2 border-b flex items-center gap-2 select-none">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Terminal className="size-3.5 text-muted-foreground/60" />
                    <span className="text-xs font-semibold">
                        Network Monitor
                    </span>
                    <div
                        className={cn(
                            "size-2 rounded-full",
                            statusColor[backendStatus],
                        )}
                    />
                    <span className="text-[10px] text-muted-foreground/60">
                        {statusLabel[backendStatus]}
                    </span>
                    <span className="text-[10px] text-muted-foreground/30">
                        ·
                    </span>
                    <span
                        className={cn(
                            "text-[10px] flex items-center gap-0.5",
                            isAuthenticated
                                ? "text-emerald-400/70"
                                : "text-red-400/70",
                        )}
                    >
                        {isAuthenticated ? (
                            <Shield className="size-3" />
                        ) : (
                            <ShieldOff className="size-3" />
                        )}
                        {isAuthenticated ? "Auth" : "No Auth"}
                    </span>
                    <span className="text-[10px] text-muted-foreground/40 tabular-nums">
                        ({filtered.length}
                        {filter ? `/${entries.length}` : ""})
                    </span>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                    <button
                        onClick={clear}
                        className="p-1 rounded hover:bg-muted text-muted-foreground/50 hover:text-foreground transition-colors"
                        title="Clear log"
                    >
                        <Trash2 className="size-3" />
                    </button>
                    <button
                        onClick={() => setFs((v) => !v)}
                        className="p-1 rounded hover:bg-muted text-muted-foreground/50 hover:text-foreground transition-colors"
                        title={fs ? "Exit fullscreen" : "Fullscreen"}
                    >
                        {fs ? (
                            <Minimize2 className="size-3" />
                        ) : (
                            <Maximize2 className="size-3" />
                        )}
                    </button>
                    <button
                        onClick={close}
                        className="p-1 rounded hover:bg-muted text-muted-foreground/50 hover:text-foreground transition-colors"
                        title="Close"
                    >
                        <X className="size-3" />
                    </button>
                </div>
            </div>

            {/* Filter */}
            <div className="shrink-0 px-3 py-1.5 border-b flex items-center gap-2">
                <Search className="size-3 text-muted-foreground/40 shrink-0" />
                <input
                    type="text"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Filter…"
                    className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/40 outline-none min-w-0"
                />
                {filter && (
                    <button
                        onClick={() => setFilter("")}
                        className="text-muted-foreground/40 hover:text-foreground shrink-0"
                    >
                        <X className="size-3" />
                    </button>
                )}
            </div>

            {/* Entries */}
            <div className="flex-1 min-h-0 overflow-auto font-mono">
                {filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground/30 gap-2 py-12">
                        <Wifi className="size-6" />
                        <p className="text-xs">No requests logged yet</p>
                    </div>
                ) : (
                    filtered.map((e) => <LogEntryRow key={e.id} entry={e} />)
                )}
            </div>

            {/* Footer */}
            <div className="shrink-0 px-3 py-1.5 border-t flex items-center justify-between text-[10px] text-muted-foreground/40 font-mono">
                <span>
                    {entries.length > 0 && (
                        <>
                            Last:{" "}
                            {new Date(entries[0].timestamp).toLocaleTimeString(
                                "en-GB",
                                { hour12: false },
                            )}
                        </>
                    )}
                </span>
                <span>
                    {backendStatus === "connected"
                        ? "● Connected"
                        : backendStatus === "disconnected"
                          ? "○ Disconnected"
                          : "◌ Checking"}
                </span>
            </div>
        </div>
    );

    return (
        <>
            {/* Navbar trigger */}
            <button
                onClick={() => setOpen((v) => !v)}
                className={cn(
                    "flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-colors hover:bg-muted/50 text-muted-foreground",
                    open && "bg-muted/60",
                )}
                title={`${statusLabel[backendStatus]} · ${isAuthenticated ? "Authenticated" : "Not authenticated"}`}
            >
                <div
                    className={cn(
                        "size-2 rounded-full transition-colors",
                        statusColor[backendStatus],
                    )}
                />
                <span className="hidden lg:inline">
                    {backendStatus === "connected" ? "Online" : "Offline"}
                </span>
            </button>

            {/* Portal: panel */}
            {open &&
                createPortal(
                    <>
                        {/* Backdrop */}
                        <div
                            className="fixed inset-0 z-[9998]"
                            style={{
                                background: fs
                                    ? "rgba(0,0,0,0.5)"
                                    : "transparent",
                            }}
                            onMouseDown={close}
                        />

                        {/* Draggable + resizable panel */}
                        <Rnd
                            dragHandleClassName="panel-drag-handle"
                            position={pos}
                            size={
                                fs
                                    ? { width: "100%", height: "100%" }
                                    : { width: sz.w, height: sz.h }
                            }
                            onDragStop={(_e, d) => {
                                if (!fs) setPos({ x: d.x, y: d.y });
                            }}
                            onResizeStop={(_e, _dir, ref, _delta, position) => {
                                if (!fs) {
                                    setPos({ x: position.x, y: position.y });
                                    setSz({
                                        w: ref.offsetWidth,
                                        h: ref.offsetHeight,
                                    });
                                }
                            }}
                            minWidth={200}
                            minHeight={150}
                            disableDragging={fs}
                            enableResizing={!fs}
                            bounds="parent"
                            className="z-[9999]"
                            style={
                                fs
                                    ? { inset: 16, position: "fixed" }
                                    : undefined
                            }
                        >
                            {panelContent}
                        </Rnd>
                    </>,
                    document.body,
                )}
        </>
    );
}
