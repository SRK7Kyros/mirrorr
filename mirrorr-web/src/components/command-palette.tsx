import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
	CalendarClock,
	Film,
	LayoutDashboard,
	Plug,
	Radio,
	Search,
	Settings,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
	Sheet,
	SheetContent,
	SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAutoruns, useRecordings, useSessions } from "@/hooks/use-queries";
import { cn } from "@/lib/utils";

interface Item {
	id: string;
	label: string;
	sub?: string;
	to: string;
	kind: "nav" | "session" | "autorun" | "recording";
	icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: Item[] = [
	{ id: "/", label: "Dashboard", to: "/", kind: "nav", icon: LayoutDashboard },
	{ id: "/sessions", label: "Sessions", to: "/sessions", kind: "nav", icon: Radio },
	{ id: "/autoruns", label: "Autoruns", to: "/autoruns", kind: "nav", icon: CalendarClock },
	{ id: "/recordings", label: "Recordings", to: "/recordings", kind: "nav", icon: Film },
	{ id: "/profiles", label: "Profiles", to: "/profiles", kind: "nav", icon: Settings },
	{ id: "/plugins", label: "Plugins", to: "/plugins", kind: "nav", icon: Plug },
];

function matchScore(label: string, sub: string | undefined, q: string): number {
	const needle = q.trim().toLowerCase();
	if (!needle) return 1;
	const full = `${label} ${sub ?? ""}`.toLowerCase();
	if (full.startsWith(needle)) return 0;
	if (full.includes(needle)) return 1;
	return Number.MAX_SAFE_INTEGER;
}

/**
 * Command palette triggered by `/` or Ctrl/Cmd+K. Searches navigation and
 * sessions / autoruns / recordings by id and name.
 */
export function CommandPalette({ open, onOpenChange }: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const navigate = useNavigate();
	const isMobile = useIsMobile();
	const { data: sessions = [] } = useSessions();
	const { data: autoruns = [] } = useAutoruns();
	const { data: recordings = [] } = useRecordings();
	const [q, setQ] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const [idx, setIdx] = useState(0);

	const items = useMemo<Item[]>(() => {
		const derived: Item[] = [
			...sessions.map((s) => ({
				id: `session-${s.id}`,
				label: s.autorun_id ? `Session #${s.id} (autorun)` : `Session #${s.id}`,
				sub: s.status,
				to: "/sessions",
				kind: "session" as const,
				icon: Radio,
			})),
			...autoruns.map((a) => ({
				id: `autorun-${a.id}`,
				label: a.user_friendly_name || `Autorun #${a.id}`,
				sub: a.status ?? "scheduled",
				to: "/autoruns",
				kind: "autorun" as const,
				icon: CalendarClock,
			})),
			...recordings.map((r) => ({
				id: `recording-${r.id}`,
				label: r.user_friendly_name || `Recording #${r.id}`,
				sub: r.content_url,
				to: "/recordings",
				kind: "recording" as const,
				icon: Film,
			})),
		];
		return [...NAV_ITEMS, ...derived];
	}, [sessions, autoruns, recordings]);

	const filtered = useMemo(() => {
		const scored = items
			.map((it) => ({ it, score: matchScore(it.label, it.sub, q) }))
			.filter((x) => x.score !== Number.MAX_SAFE_INTEGER);
		scored.sort((a, b) => a.score - b.score || a.it.label.localeCompare(b.it.label));
		return scored.map((x) => x.it).slice(0, 20);
	}, [items, q]);

	useEffect(() => {
		if (open) {
			setQ("");
			setIdx(0);
			requestAnimationFrame(() => inputRef.current?.focus());
		}
	}, [open]);

	useEffect(() => {
		setIdx(0);
	}, [q]);

	useEffect(() => {
		const el = listRef.current?.querySelector(`[data-idx="${idx}"]`);
		el?.scrollIntoView({ block: "nearest" });
	}, [idx]);

	const run = (item: Item) => {
		onOpenChange(false);
		navigate({ to: item.to });
	};

	const searchBody = (
		<>
			<div className="flex items-center gap-2 px-3 border-b">
				<Search className="size-4 text-muted-foreground shrink-0" />
				<Input
					ref={inputRef}
					value={q}
					onChange={(e) => setQ(e.target.value)}
					placeholder="Search sessions, autoruns, recordings, pages…"
					enterKeyHint="search"
					autoComplete="off"
					className="border-0 bg-transparent px-0 h-11 focus-visible:ring-0 focus-visible:ring-offset-0"
					onKeyDown={(e) => {
						if (e.key === "ArrowDown") {
							e.preventDefault();
							setIdx((i) => Math.min(i + 1, filtered.length - 1));
						} else if (e.key === "ArrowUp") {
							e.preventDefault();
							setIdx((i) => Math.max(i - 1, 0));
						} else if (e.key === "Enter" && filtered[idx]) {
							e.preventDefault();
							run(filtered[idx]);
						}
					}}
				/>
			</div>
			<div ref={listRef} className="max-h-80 overflow-auto p-2 space-y-0.5">
				{filtered.length === 0 ? (
					<p className="px-2 py-6 text-center text-xs text-muted-foreground">
						No matches
					</p>
				) : (
					filtered.map((item, i) => {
						const Icon = item.icon;
						return (
							<button
								key={item.id}
								type="button"
								data-idx={i}
								onClick={() => run(item)}
								onMouseEnter={() => setIdx(i)}
								className={cn(
									"w-full flex items-center gap-2.5 rounded-md text-left text-sm transition-colors min-h-12 px-2.5 py-3",
									i === idx
										? "bg-accent text-accent-foreground"
										: "hover:bg-muted/50",
								)}
							>
								<Icon className="size-4 text-muted-foreground shrink-0" />
								<span className="truncate font-medium">{item.label}</span>
								{item.sub && (
									<span className="ml-auto text-xs text-muted-foreground truncate max-w-[160px]">
										{item.sub}
									</span>
								)}
							</button>
						);
					})
				)}
			</div>
		</>
	);

	if (isMobile) {
		return (
			<Sheet open={open} onOpenChange={onOpenChange}>
				<SheetContent
					side="bottom"
					data-testid="palette-sheet"
					className="rounded-t-2xl pb-[env(safe-area-inset-bottom)]"
				>
					<SheetTitle className="sr-only">Command palette</SheetTitle>
					{searchBody}
				</SheetContent>
			</Sheet>
		);
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent showCloseButton={false} className="sm:max-w-lg p-0 gap-0">
				<DialogTitle className="sr-only">Command palette</DialogTitle>
				{searchBody}
			</DialogContent>
		</Dialog>
	);
}