import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { sessionsApi, profilesApi, autorunsApi, pluginsApi } from "@/lib/api"
import type { Session, Autorun } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Trash2, Radio, Loader2, Clock } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { InfoGrid } from "@/components/info-grid";
import { KeyValueTable } from "@/components/key-value-table";
import { SidebarLayout, SidebarEntry, DetailHeader, DetailLayout, CreatePanel, EmptyDetail } from "@/components/resource-layout";
import { FormField } from "@/components/form-field";
import { ResizableSidebar } from "@/components/resizable-sidebar";
import { formatDuration, formatLocalDate, parseUtcDate } from "@/lib/utils";
import { useState, useMemo, useEffect, useRef } from "react";
import { useInterval } from "@/hooks/use-interval";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/sessions/")({
    component: SessionsPage,
});

function SessionsPage() {
    const [showCreate, setShowCreate] = useState(false);
    const [selectedId, setSelectedId] = useState<number | null>(null);

    const { data: sessions = [], isLoading } = useQuery({
        queryKey: ["sessions"],
        queryFn: () => sessionsApi.list(),
    });

    const { data: autoruns = [] } = useQuery({
        queryKey: ["autoruns"],
        queryFn: () => autorunsApi.list(),
    });

    const autorunMap = useMemo(
        () => Object.fromEntries(autoruns.map((a) => [a.id, a])),
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
        mutationFn: (session) =>
            session.recording
                ? sessionsApi.disableRecording(session.id)
                : sessionsApi.enableRecording(session.id),
        onError: (err: Error) =>
            toast.error(`Failed to toggle recording: ${err.message}`),
    });

    // Clear deletingId once the session is gone from the list (WS confirmation received)
    useEffect(() => {
        if (deletingId !== null && !sessions.some((s) => s.id === deletingId)) {
            setDeletingId(null);
        }
    }, [deletingId, sessions]);

    return (
        <ResizableSidebar>
            <SidebarLayout
                title="Sessions"
                count={sessions.length}
                countLabel="total"
                onNew={() => setShowCreate(true)}
                isLoading={isLoading}
                emptyText="No sessions"
                className="bg-card border rounded-xl h-full"
            >
            {sessions.map((s) => (
                <SessionEntry
                    key={s.id}
                    session={s}
                    autorun={s.autorun_id ? autorunMap[s.autorun_id] : null}
                    selected={selectedId === s.id}
                    onSelect={() => { setSelectedId(s.id); setShowCreate(false) }}
                />
            ))}
            </SidebarLayout>
            {showCreate ? (
                <CreateSessionPanel onClose={() => setShowCreate(false)} />
            ) : selectedId ? (
                <SessionDetail
                    session={sessions.find((s) => s.id === selectedId)}
                    onBack={() => setSelectedId(null)}
                    onDelete={() => { setDeletingId(selectedId); deleteMutation.mutate(selectedId) }}
                    onToggleRec={() => {
                        const session = sessions.find((s) => s.id === selectedId);
                        if (session) toggleRecMutation.mutate(session);
                    }}
                    deleting={deletingId === selectedId}
                />
            ) : (
                <EmptyDetail icon={Radio} text="Select a session or create one" />
            )}
        </ResizableSidebar>
    );
}

function SessionEntry({
    session,
    autorun,
    selected,
    onSelect,
}: {
    session: Session;
    autorun: Autorun | undefined;
    selected: boolean;
    onSelect: () => void;
}) {
    const completedDuration = (session.attempts || [])
        .filter((a) => a.duration_seconds != null)
        .reduce((sum: number, a) => sum + a.duration_seconds, 0)
    const runningAttempt = (session.attempts || []).find((a) => a.ended_at == null)

    const displayName = autorun?.user_friendly_name ?? `Session #${session.id}`;

    return (
        <SidebarEntry selected={selected} onClick={onSelect} className="relative">
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
        </SidebarEntry>
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

    useInterval(() => {
        const sa = startedAtRef.current
        if (sa) {
            setElapsed(offsetRef.current + (Date.now() - (parseUtcDate(sa)?.getTime() ?? Date.now())) / 1000)
        }
    }, startedAtRef.current ? 100 : null)

    return <span className="tabular-nums">{formatDuration(elapsed)}</span>
}

function SessionDetail({
    session,
    onBack,
    onDelete,
    onToggleRec,
    deleting,
}: {
    session: Session | undefined;
    onBack: () => void;
    onDelete: () => void;
    onToggleRec: () => void;
    deleting: boolean;
}) {
    if (!session) return null;

    // Compute offset: sum of durations of all completed attempts
    const completedDuration = (session.attempts || [])
        .filter((a) => a.duration_seconds != null)
        .reduce((sum: number, a) => sum + a.duration_seconds, 0)

    // Find the currently running attempt (if any)
    const runningAttempt = (session.attempts || []).find((a) => a.ended_at == null)

    const { data: profiles = [] } = useQuery({ queryKey: ["profiles"], queryFn: () => profilesApi.list() as Promise<any[]> });
    const { data: engines = [] } = useQuery({ queryKey: ["engines"], queryFn: () => pluginsApi.engines() as Promise<any[]> });
    const { data: resolvers = [] } = useQuery({ queryKey: ["resolvers"], queryFn: () => pluginsApi.resolvers() as Promise<any[]> });

    // 3-state recording switch: original → pending (center) → confirmed (final)
    const [recPending, setRecPending] = useState(false);
    useEffect(() => { setRecPending(false) }, [session.recording]);

    const profile = profiles.find((p) => p.id === session.profile_id);
    const engine = engines.find((e) => e.id === session.engine_id);
    const resolver = resolvers.find((r) => r.id === profile?.resolver_id);

    return (
        <DetailLayout
            header={
                <DetailHeader
                    onBack={onBack}
                    title={`Session #${session.id}`}
                    actions={
                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2">
                                <Label className="text-[11px] text-muted-foreground">Recording</Label>
                                <Switch
                                    checked={!!session.recording}
                                    pending={recPending}
                                    onCheckedChange={() => {
                                        setRecPending(true);
                                        onToggleRec();
                                    }}
                                />
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
                    }
                />
            }
        >
            <InfoGrid fields={[
                { label: "Status", value: <StatusBadge status={session.status} /> },
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
                                {[...session.attempts].reverse().map((a) => (
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
        </DetailLayout>
    );
}

function CreateSessionPanel({ onClose }: { onClose: () => void }) {
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
        (p) => p.id === parseInt(profileId),
    );

    return (
        <CreatePanel
            title="New Session"
            onClose={onClose}
            submitLabel="Start Session"
            onSubmit={() => {
                if (!selectedProfile) return;
                createMutation.mutate({
                    profile_id: selectedProfile.id,
                    engine_id: engineOverrideId
                        ? parseInt(engineOverrideId)
                        : selectedProfile.default_engine_id,
                    recording,
                });
            }}
            isPending={createMutation.isPending}
            canSubmit={!!profileId}
        >
            <div className="grid grid-cols-2 grid-rows-1 gap-3">
                <FormField label="Profile">
                    <Select
                        value={profileId}
                        onValueChange={setProfileId}
                        items={profiles.map((p) => ({
                            value: String(p.id),
                            label: p.name,
                        }))}
                    >
                        <SelectTrigger className="h-8 text-xs w-full">
                            <SelectValue placeholder="Select profile" />
                        </SelectTrigger>
                        <SelectContent>
                            {profiles.map((p) => (
                                <SelectItem
                                    key={p.id}
                                    value={String(p.id)}
                                >
                                    {p.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FormField>
                <FormField label="Engine Override">
                    <Select
                        value={engineOverrideId}
                        onValueChange={setEngineOverrideId}
                        items={engines.map((e) => ({
                            value: String(e.id),
                            label: `${e.name}${selectedProfile && e.id === selectedProfile.default_engine_id ? " (Default)" : ""}`,
                        }))}
                        disabled={!profileId}
                    >
                        <SelectTrigger className="h-8 text-xs w-full">
                            <SelectValue placeholder="Override engine" />
                        </SelectTrigger>
                        <SelectContent>
                            {engines.map((e) => (
                                <SelectItem
                                    key={e.id}
                                    value={String(e.id)}
                                >
                                    {e.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FormField>
            </div>
            <div className="flex items-center justify-between">
                <Label className="text-[11px]">Recording</Label>
                <Switch
                    checked={recording}
                    onCheckedChange={setRecording}
                />
            </div>
        </CreatePanel>
    );
}
