import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sessionsApi, profilesApi, autorunsApi, pluginsApi } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Radio, Loader2, Clock } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { InfoGrid, StatusField } from "@/components/info-grid";
import { KeyValueTable } from "@/components/key-value-table";
import { formatDuration, cn, formatLocalDate, parseUtcDate } from "@/lib/utils";
import { useState, useMemo, useEffect, useRef } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/sessions/")({
    component: SessionsPage,
});

function SessionsPage() {
    const queryClient = useQueryClient();
    const [showCreate, setShowCreate] = useState(false);
    const [selectedId, setSelectedId] = useState<number | null>(null);

    const { data: sessions = [], isLoading } = useQuery({
        queryKey: ["sessions"],
        queryFn: () => sessionsApi.list() as Promise<any[]>,
    });

    const { data: autoruns = [] } = useQuery({
        queryKey: ["autoruns"],
        queryFn: () => autorunsApi.list() as Promise<any[]>,
    });

    const autorunMap = useMemo(
        () => Object.fromEntries(autoruns.map((a: any) => [a.id, a])),
        [autoruns],
    );

    const [deletingId, setDeletingId] = useState<number | null>(null)

    const deleteMutation = useMutation({
        mutationFn: (id: number) => sessionsApi.delete(id),
        onSuccess: () => {
            toast.success("Session deletion requested");
        },
        onError: (err: Error) => {
            toast.error(`Failed to delete session: ${err.message}`);
            setDeletingId(null);
        },
    });
    const toggleRecMutation = useMutation({
        mutationFn: (session: any) =>
            session.recording
                ? sessionsApi.disableRecording(session.id)
                : sessionsApi.enableRecording(session.id),
        onError: (err: Error) =>
            toast.error(`Failed to toggle recording: ${err.message}`),
    });

    // Clear deletingId once the session is gone from the list (WS confirmation received)
    useEffect(() => {
        if (deletingId !== null && !sessions.some((s: any) => s.id === deletingId)) {
            setDeletingId(null);
        }
    }, [deletingId, sessions]);

    return (
        <div className="h-full grid grid-cols-[300px_1fr] gap-2 p-2">
            {/* Sidebar */}
            <div className="flex flex-col min-h-0 bg-card border rounded-xl overflow-hidden">
                <div className="shrink-0 px-3.5 pt-4 pb-3 flex items-center justify-between">
                    <div>
                        <h1 className="text-lg font-bold tracking-tight">
                            Sessions
                        </h1>
                        <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                            {sessions.length} total
                        </p>
                    </div>
                    <Button
                        size="sm"
                        className="h-7 text-[11px]"
                        onClick={() => setShowCreate(true)}
                    >
                        <Plus className="size-3 mr-1" />
                        New
                    </Button>
                </div>
                <ScrollArea className="flex-1 min-h-0">
                    <div className="p-1.5 space-y-px">
                        {isLoading ? (
                            <div className="text-[11px] text-muted-foreground text-center py-6">
                                Loading...
                            </div>
                        ) : sessions.length === 0 ? (
                            <div className="text-[11px] text-muted-foreground text-center py-6">
                                No sessions
                            </div>
                        ) : (
                            sessions.map((s: any) => (
                                <SessionEntry
                                    key={s.id}
                                    session={s}
                                    autorun={
                                        s.autorun_id
                                            ? autorunMap[s.autorun_id]
                                            : null
                                    }
                                    selected={selectedId === s.id}
                                    onSelect={() => {
                                        setSelectedId(s.id);
                                        setShowCreate(false);
                                    }}
                                />
                            ))
                        )}
                    </div>
                </ScrollArea>
            </div>

            {/* Detail / Create panel */}
            <div className="min-h-0 overflow-auto bg-card border rounded-xl">
                {showCreate ? (
                    <CreateSessionPanel onClose={() => setShowCreate(false)} />
                ) : selectedId ? (
                    <SessionDetail
                        session={sessions.find((s: any) => s.id === selectedId)}
                        onBack={() => setSelectedId(null)}
                        onDelete={() => {
                            setDeletingId(selectedId);
                            deleteMutation.mutate(selectedId);
                        }}
                        onToggleRec={() => {
                            const session = sessions.find((s: any) => s.id === selectedId);
                            if (session) toggleRecMutation.mutate(session);
                        }}
                        deleting={deletingId === selectedId}
                    />
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                        <Radio className="size-8 mb-2 opacity-15" />
                        <p className="text-xs">
                            Select a session or create one
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}

function SessionEntry({
    session,
    autorun,
    selected,
    onSelect,
}: {
    session: any;
    autorun: any;
    selected: boolean;
    onSelect: () => void;
}) {
    const completedDuration = (session.attempts || [])
        .filter((a: any) => a.duration_seconds != null)
        .reduce((sum: number, a: any) => sum + a.duration_seconds, 0)
    const runningAttempt = (session.attempts || []).find((a: any) => a.ended_at == null)

    const displayName = autorun?.user_friendly_name ?? `Session #${session.id}`;

    return (
        <div
            className={cn(
                "relative px-2.5 py-2.5 rounded-md transition-colors cursor-pointer",
                selected ? "bg-muted/60" : "hover:bg-muted/40",
            )}
            onClick={onSelect}
        >
            <div className="absolute top-2 right-2">
                <StatusBadge status={session.status} />
            </div>
            <div className="flex items-center gap-2 pr-20">
                <span className="text-[13px] font-medium truncate">
                    {displayName}
                </span>
                <span className="text-[10px] text-muted-foreground/60 shrink-0 flex items-center gap-1">
                    <Clock className="size-3" />
                    <LiveCountup startedAt={runningAttempt?.started_at ?? null} offset={completedDuration} />
                </span>
            </div>
            <div className="mt-1 h-[14px]" />
        </div>
    );
}

/**
 * Live-updating elapsed time counter. Shows `offset + (now - startedAt)`.
 * - `startedAt`: ISO timestamp to count from
 * - `offset`: seconds already elapsed (e.g. sum of completed attempts)
 * Ticks every 100ms. When `startedAt` is null, just shows `offset` statically.
 */
function LiveCountup({ startedAt, offset = 0 }: { startedAt: string | null; offset?: number }) {
    const startedAtRef = useRef(startedAt)
    startedAtRef.current = startedAt

    const offsetRef = useRef(offset)
    offsetRef.current = offset

    const [elapsed, setElapsed] = useState(() => {
        if (!startedAt) return offset
        return offset + (Date.now() - (parseUtcDate(startedAt)?.getTime() ?? Date.now())) / 1000
    })

    useEffect(() => {
        if (!startedAtRef.current) { setElapsed(offsetRef.current); return }
        const id = setInterval(() => {
            const sa = startedAtRef.current
            if (sa) {
                setElapsed(offsetRef.current + (Date.now() - (parseUtcDate(sa)?.getTime() ?? Date.now())) / 1000)
            }
        }, 100)
        return () => clearInterval(id)
    }, [startedAt])

    return <span className="tabular-nums">{formatDuration(elapsed)}</span>
}

function SessionDetail({
    session,
    onBack,
    onDelete,
    onToggleRec,
    deleting,
}: {
    session: any;
    onBack: () => void;
    onDelete: () => void;
    onToggleRec: () => void;
    deleting: boolean;
}) {
    if (!session) return null;

    // Compute offset: sum of durations of all completed attempts
    const completedDuration = (session.attempts || [])
        .filter((a: any) => a.duration_seconds != null)
        .reduce((sum: number, a: any) => sum + a.duration_seconds, 0)

    // Find the currently running attempt (if any)
    const runningAttempt = (session.attempts || []).find((a: any) => a.ended_at == null)

    const { data: profiles = [] } = useQuery({ queryKey: ["profiles"], queryFn: () => profilesApi.list() as Promise<any[]> });
    const { data: engines = [] } = useQuery({ queryKey: ["engines"], queryFn: () => pluginsApi.engines() as Promise<any[]> });
    const { data: resolvers = [] } = useQuery({ queryKey: ["resolvers"], queryFn: () => pluginsApi.resolvers() as Promise<any[]> });

    // 3-state recording switch: original → pending (center) → confirmed (final)
    const [recPending, setRecPending] = useState(false);
    useEffect(() => { setRecPending(false) }, [session.recording]);

    const profile = profiles.find((p: any) => p.id === session.profile_id);
    const engine = engines.find((e: any) => e.id === session.engine_id);
    const resolver = resolvers.find((r: any) => r.id === profile?.resolver_id);

    return (
        <div className="flex flex-col h-full">
            <div className="shrink-0 px-5 pt-5 pb-3 border-b">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-[11px]"
                            onClick={onBack}
                        >
                            ← Back
                        </Button>
                        <h2 className="text-sm font-bold">
                            Session #{session.id}
                        </h2>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                            <Label className="text-[11px] text-muted-foreground">Recording</Label>
                            <div className="relative">
                                <Switch
                                    checked={!!session.recording}
                                    pending={recPending}
                                    onCheckedChange={() => {
                                        setRecPending(true);
                                        onToggleRec();
                                    }}
                                />
                            </div>
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-[11px] text-destructive"
                            onClick={onDelete}
                            disabled={deleting}
                        >
                            {deleting ? <Loader2 className="size-3 mr-1 animate-spin" /> : <Trash2 className="size-3 mr-1" />}
                            Delete
                        </Button>
                    </div>
                </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                <InfoGrid columns={5} fields={[
                    { label: "Status", value: <StatusField status={session.status} /> },
                    { label: "Duration", value: <LiveCountup startedAt={runningAttempt?.started_at ?? null} offset={completedDuration} /> },
                    { label: "Profile", value: profile?.name ?? `#${session.profile_id}` },
                    { label: "Engine", value: engine?.name ?? `#${session.engine_id}` },
                    { label: "Resolver", value: resolver?.name ?? "?" },
                ]} />
                <div className="flex gap-6">
                    {session.started_at && (
                        <div className="space-y-1 shrink-0">
                            <Label className="text-[11px] text-muted-foreground">Started</Label>
                            <p className="text-xs">{formatLocalDate(session.started_at)}</p>
                        </div>
                    )}
                    {session.ended_at && (
                        <div className="space-y-1 shrink-0">
                            <Label className="text-[11px] text-muted-foreground">Ended</Label>
                            <p className="text-xs">{formatLocalDate(session.ended_at)}</p>
                        </div>
                    )}
                </div>
                {session.error && (
                    <div className="space-y-1">
                        <Label className="text-[11px] text-destructive">Error</Label>
                        <p className="text-xs text-destructive">{session.error}</p>
                    </div>
                )}
                {session.session_urls?.length > 0 && (
                    <KeyValueTable
                        title="Public URLs"
                        leftAlignValues
                        entries={session.session_urls.map((entry: Record<string, string>) => [
                            entry.label,
                            <a href={entry.url} target="_blank" rel="noopener noreferrer" className="text-[11px] font-mono text-foreground/80 hover:text-foreground hover:underline">{entry.url}</a>,
                        ])}
                    />
                )}
                {session.attempts?.length > 0 && (
                    <div className="space-y-1.5">
                        <Label className="text-[11px] text-muted-foreground">
                            Attempts ({session.attempts.length})
                        </Label>
                        <div className="border rounded-lg overflow-hidden">
                            <Table>
                                <TableHeader>
                                    <TableRow className="h-7">
                                        <TableHead className="text-[10px] font-medium h-7 px-2">#</TableHead>
                                        <TableHead className="text-[10px] font-medium h-7 px-2">Started</TableHead>
                                        <TableHead className="text-[10px] font-medium h-7 px-2">Ended</TableHead>
                                        <TableHead className="text-[10px] font-medium h-7 px-2">Duration</TableHead>
                                        <TableHead className="text-[10px] font-medium h-7 px-2">Exit Code</TableHead>
                                        <TableHead className="text-[10px] font-medium h-7 px-2">Reason</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {session.attempts.map((a: any) => (
                                        <TableRow key={a.index} className="h-7">
                                            <TableCell className="text-[11px] font-mono px-2 py-1">{a.index}</TableCell>
                                            <TableCell className="text-[11px] font-mono px-2 py-1 text-muted-foreground">
                                                {a.started_at ? formatLocalDate(a.started_at) : "—"}
                                            </TableCell>
                                            <TableCell className="text-[11px] font-mono px-2 py-1 text-muted-foreground">
                                                {a.ended_at
                                                    ? formatLocalDate(a.ended_at)
                                                    : <span className="inline-flex items-center gap-1">
                                                        <Loader2 className="size-3 animate-spin" />
                                                        running…
                                                      </span>}
                                            </TableCell>
                                            <TableCell className="text-[11px] font-mono px-2 py-1 text-muted-foreground tabular-nums">
                                                {a.duration_seconds != null
                                                    ? formatDuration(a.duration_seconds)
                                                    : a.ended_at == null
                                                        ? <LiveCountup startedAt={a.started_at} />
                                                        : "—"}
                                            </TableCell>
                                            <TableCell className="text-[11px] font-mono px-2 py-1">
                                                {a.returncode != null
                                                    ? <span className={a.returncode === 0 ? "text-emerald-500" : "text-red-500"}>{a.returncode}</span>
                                                    : <span className="text-muted-foreground/40">—</span>}
                                            </TableCell>
                                            <TableCell className="text-[11px] font-mono px-2 py-1 text-muted-foreground max-w-[200px] truncate">
                                                {a.reason ?? "—"}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function CreateSessionPanel({ onClose }: { onClose: () => void }) {
    const queryClient = useQueryClient();
    const [profileId, setProfileId] = useState("");
    const [engineOverrideId, setEngineOverrideId] = useState("");
    const [recording, setRecording] = useState(false);

    const { data: profiles = [] } = useQuery({
        queryKey: ["profiles"],
        queryFn: () => profilesApi.list() as Promise<any[]>,
    });
    const { data: engines = [] } = useQuery({
        queryKey: ["engines"],
        queryFn: () => pluginsApi.engines() as Promise<any[]>,
    });

    const createMutation = useMutation({
        mutationFn: (data: Record<string, unknown>) => sessionsApi.create(data),
        onSuccess: () => {
            onClose();
            toast.success("Session created");
        },
        onError: (err: Error) =>
            toast.error(`Failed to create session: ${err.message}`),
    });

    const selectedProfile = profiles.find(
        (p: any) => p.id === parseInt(profileId),
    );

    return (
        <div className="flex flex-col h-full">
            <div className="shrink-0 px-5 pt-5 pb-3 border-b">
                <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold">New Session</h2>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[11px]"
                        onClick={onClose}
                    >
                        Cancel
                    </Button>
                </div>
            </div>
            <div className="relative flex-1 min-h-0">
                <div className="absolute inset-x-0 bottom-0 z-10 px-5 py-3 flex justify-center">
                    <Button
                        size="sm"
                        className="h-8 text-[11px] px-6 shadow-lg"
                        onClick={() => {
                            if (!selectedProfile) return;
                            createMutation.mutate({
                                profile_id: selectedProfile.id,
                                engine_id: engineOverrideId
                                    ? parseInt(engineOverrideId)
                                    : selectedProfile.default_engine_id,
                                recording,
                            });
                        }}
                        disabled={!profileId || createMutation.isPending}
                    >
                        {createMutation.isPending && (
                            <Loader2 className="mr-1 size-3 animate-spin" />
                        )}
                        Start Session
                    </Button>
                </div>
                <div className="h-full overflow-y-auto px-5 py-4 pb-14 space-y-3">
                    <div className="grid grid-cols-2 grid-rows-1 gap-3">
                        <div className="space-y-1.5">
                            <Label className="text-[11px]">Profile</Label>
                            <Select
                                value={profileId}
                                onValueChange={setProfileId}
                                items={profiles.map((p: any) => ({
                                    value: String(p.id),
                                    label: p.name,
                                }))}
                            >
                                <SelectTrigger className="h-8 text-xs w-full">
                                    <SelectValue placeholder="Select profile" />
                                </SelectTrigger>
                                <SelectContent>
                                    {profiles.map((p: any) => (
                                        <SelectItem
                                            key={p.id}
                                            value={String(p.id)}
                                        >
                                            {p.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-[11px]">
                                Engine Override
                            </Label>
                            <Select
                                value={engineOverrideId}
                                onValueChange={setEngineOverrideId}
                                items={engines.map((e: any) => ({
                                    value: String(e.id),
                                    label: `${e.name}${selectedProfile && e.id === selectedProfile.default_engine_id ? " (Default)" : ""}`,
                                }))}
                                disabled={!profileId}
                            >
                                <SelectTrigger className="h-8 text-xs w-full">
                                    <SelectValue placeholder="Override engine" />
                                </SelectTrigger>
                                <SelectContent>
                                    {engines.map((e: any) => (
                                        <SelectItem
                                            key={e.id}
                                            value={String(e.id)}
                                        >
                                            {e.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div className="flex items-center justify-between">
                        <Label className="text-[11px]">Recording</Label>
                        <Switch
                            checked={recording}
                            onCheckedChange={setRecording}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
