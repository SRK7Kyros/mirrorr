import {
	createFileRoute,
	Link,
	Outlet,
	redirect,
	useLocation,
	useNavigate,
} from "@tanstack/react-router";
import {
	Bell,
	CalendarClock,
	CheckCircle,
	Film,
	LayoutDashboard,
	LogOut,
	Plug,
	Radio,
	Search,
	Settings,
	User,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/logo";
import { CommandPalette } from "@/components/command-palette";
import {
	NetworkMonitor,
	NetworkStatusDot,
	NetworkStatusTracker,
} from "@/components/network-monitor";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useWsEvents } from "@/hooks/use-ws-events";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { useWsNotifications } from "@/hooks/use-ws-notifications";
import { startTokenRefresh, stopTokenRefresh } from "@/lib/api";
import type { Notification } from "@/lib/schemas";
import { APP_SHELL, AREAS } from "@/lib/layouts";
import { cn, formatLocalDate, getUserInitial } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { useRequestLogStore } from "@/stores/request-log-store";

export const Route = createFileRoute("/_app")({
	beforeLoad: async () => {
		// Wait for zustand hydration before checking auth state
		await new Promise<void>((resolve) => {
			const unsub = useAuthStore.persist.onFinishHydration(() => {
				unsub();
				resolve();
			});
			// If already hydrated, resolve immediately
			if (useAuthStore.persist.hasHydrated()) {
				unsub();
				resolve();
			}
		});
		const { isAuthenticated } = useAuthStore.getState();
		if (!isAuthenticated) {
			throw redirect({ to: "/login" });
		}
		const { useServerStore: _ss2, isServerLocked: _lock2 } = await import("@/lib/server");
		await new Promise<void>((resolve) => {
			const unsub = _ss2.persist.onFinishHydration(() => {
				unsub();
			resolve();
			});
			if (_ss2.persist.hasHydrated()) {
				unsub();
			resolve();
			}
		});
		if (!_lock2() && _ss2.getState().instances.length === 0) {
			throw redirect({ to: "/server" });
		}
	},
	component: AppLayout,
});

interface NavItem {
	label: string;
	to: string;
	icon: React.ComponentType<{ className?: string }>;
}

const navItems: NavItem[] = [
	{ label: "Dashboard", to: "/", icon: LayoutDashboard },
	{ label: "Sessions", to: "/sessions", icon: Radio },
	{ label: "Autoruns", to: "/autoruns", icon: CalendarClock },
	{ label: "Recordings", to: "/recordings", icon: Film },
	{ label: "Profiles", to: "/profiles", icon: Settings },
	{ label: "Plugins", to: "/plugins", icon: Plug },
];

const mobileTabs: { label: string; to: string; icon: React.ComponentType<{ className?: string }>; match: (pathname: string) => boolean }[] = [
	{
		label: "Live",
		to: "/sessions",
		icon: Radio,
		match: (p) => p.startsWith("/sessions") || p.startsWith("/monitoring"),
	},
	{
		label: "Schedule",
		to: "/autoruns",
		icon: CalendarClock,
		match: (p) => p.startsWith("/autoruns"),
	},
	{
		label: "Archive",
		to: "/recordings",
		icon: Film,
		match: (p) => p.startsWith("/recordings"),
	},
	{
		label: "Config",
		to: "/profiles",
		icon: Settings,
		match: (p) => p.startsWith("/profiles") || p.startsWith("/plugins"),
	},
	{
		label: "More",
		to: "/",
		icon: LayoutDashboard,
		match: (p) => p === "/" || p.startsWith("/profile"),
	},
];

function NavItemComponent({
	item,
	isActive,
	className,
}: {
	item: NavItem;
	isActive: boolean;
	className?: string;
}) {
	const Icon = item.icon;
	return (
		<Link
			to={item.to}
			className={cn(
				"flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[13px] font-medium transition-colors",
				isActive
					? "bg-muted text-foreground"
					: "text-muted-foreground hover:text-foreground hover:bg-muted/50",
				className,
			)}
		>
			<Icon className="size-3.5 shrink-0" />
			{item.label}
		</Link>
	);
}

function AppLayout() {
	const location = useLocation();
	const navigate = useNavigate();
	const user = useAuthStore((s) => s.user);
	const logout = useAuthStore((s) => s.logout);
	const [netOpen, setNetOpen] = useState(false);
	const [cmdOpen, setCmdOpen] = useState(false);
	const [netPos, setNetPos] = useState<{ x: number; y: number }>({
		x: 80,
		y: 80,
	});
	const netTriggerRef = useRef<HTMLButtonElement>(null);
	const backendStatus = useRequestLogStore((s) => s.backendStatus);

	useWsEvents();
	const { notifications, markRead, clearAll } = useWsNotifications();
	useKeyboardInset();

	// Start periodic token refresh when app loads
	useEffect(() => {
		startTokenRefresh();
		return () => stopTokenRefresh();
	}, []);

	// Open command palette with "/" or Ctrl/Cmd+K
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const isCmdK = e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey);
			if (isCmdK) {
				e.preventDefault();
				setCmdOpen((o) => !o);
				return;
			}
			if (e.key !== "/") return;
			const el = e.target as HTMLElement | null;
			const typing =
				el?.tagName === "INPUT" ||
				el?.tagName === "TEXTAREA" ||
				el?.tagName === "SELECT" ||
				el?.isContentEditable;
			if (typing) return;
			e.preventDefault();
			setCmdOpen(true);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	// Redirect to login if auth is cleared while on this page
	useEffect(() => {
		const unsub = useAuthStore.subscribe((state, prev) => {
			if (prev.isAuthenticated && !state.isAuthenticated) {
				navigate({ to: "/login" });
			}
		});
		return unsub;
	}, [navigate]);

	// Redirect to login after sustained disconnection
	useEffect(() => {
		if (backendStatus !== "disconnected") return;
		const timer = setTimeout(() => {
			logout();
		}, 60_000); // 60s grace period
		return () => clearTimeout(timer);
	}, [backendStatus, logout]);

	const filteredNav = navItems;

	return (
		<div
			className="h-dvh grid bg-background overflow-hidden supports-[height:100dvh]:h-dvh"
			style={APP_SHELL.style}
		>
			{/* ── Top Navbar ────────────────────────────────────────── */}
			<header
				className="flex min-h-[calc(3rem+max(env(safe-area-inset-top),12px))] items-center border-b bg-background/80 backdrop-blur-xl pt-[max(env(safe-area-inset-top),12px)]"
				style={{ gridArea: AREAS.navbar }}
			>
				{/* Logo */}
				<div className="px-4 shrink-0 hidden sm:block">
					<Logo />
				</div>

				<Separator
					orientation="vertical"
					className="h-5 shrink-0 hidden sm:block"
				/>

				{/* Desktop nav links */}
				<nav className="hidden md:flex items-center gap-1 px-3">
					{filteredNav.map((item) => {
						const isActive =
							item.to === "/"
								? location.pathname === "/"
								: location.pathname.startsWith(item.to);
						return (
							<NavItemComponent key={item.to} item={item} isActive={isActive} />
						);
					})}
				</nav>

				<div className="flex-1" />

				{/* Right actions */}
				<div className="flex items-center gap-0.5 pr-3">
					{/* Command palette trigger */}
					<Button
						variant="ghost"
						size="icon-sm"
						className="relative"
						onClick={() => setCmdOpen(true)}
						title="Search (/)"
					>
						<Search className="size-4" />
						<span className="sr-only">Search</span>
					</Button>

					{/* Network status + monitor trigger */}
					<Button
						variant="outline"
						size="sm"
						ref={netTriggerRef}
						className="relative h-7 px-2"
						onClick={() => {
							if (!netOpen && netTriggerRef.current) {
								const rect = netTriggerRef.current.getBoundingClientRect();
								const winWidth = 420;
								// Right-align: align right edge of window with right edge of button
								let x = rect.right - winWidth;
								x = Math.max(8, Math.min(x, window.innerWidth - winWidth - 8));
								setNetPos({ x, y: rect.bottom + 8 });
							}
							setNetOpen(!netOpen);
						}}
					>
						<NetworkStatusDot />
						<span className="sr-only">Network Monitor</span>
					</Button>

					{/* Notifications */}
					<Popover>
						<PopoverTrigger
							render={
								<Button variant="ghost" size="icon-sm" className="relative" />
							}
						>
							<Bell className="size-4" />
							{notifications.length > 0 && (
								<span className="absolute -top-0.5 -right-0.5 size-4 rounded-full bg-destructive text-micro font-medium text-destructive-foreground flex items-center justify-center">
									{notifications.length > 9 ? "9+" : notifications.length}
								</span>
							)}
							<span className="sr-only">Notifications</span>
						</PopoverTrigger>
						<PopoverContent className="w-80 p-0" align="end">
							<div className="flex items-center justify-between px-4 py-3 border-b">
								<h3 className="font-semibold text-sm">Notifications</h3>
								{notifications.length > 0 && (
									<Button
										variant="ghost"
										size="sm"
										className="h-7 text-xs"
										onClick={clearAll}
									>
										Clear all
									</Button>
								)}
							</div>
							{notifications.length === 0 ? (
								<div className="py-8 text-center text-sm text-muted-foreground">
									No new notifications
								</div>
							) : (
								<ScrollArea className="h-72">
									<div className="divide-y">
										{notifications.map((notif: Notification) => (
											<div
												key={notif.id}
												className="px-4 py-3 space-y-1 hover:bg-muted/50 transition-colors"
											>
												<div className="flex items-start justify-between gap-2">
													<p className="text-sm font-medium leading-tight">
														{notif.title}
													</p>
													<Button
														variant="ghost"
														size="icon-xs"
														className="shrink-0 mt-0.5"
														onClick={() => {
															if (notif.id !== undefined) markRead(notif.id);
														}}
													>
														<CheckCircle className="size-3" />
													</Button>
												</div>
												{notif.body && (
													<p className="text-xs text-muted-foreground leading-relaxed">
														{notif.body}
													</p>
												)}
												<p className="text-micro text-muted-foreground/70">
													{notif.resource_type} ·{" "}
													{formatLocalDate(notif.created_at)}
												</p>
											</div>
										))}
									</div>
								</ScrollArea>
							)}
						</PopoverContent>
					</Popover>

					{/* Theme toggle */}
					<ThemeToggle />

					{/* User menu */}
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<Button variant="ghost" size="icon-sm" className="ml-1" />
							}
						>
							<Avatar className="size-7">
								<AvatarFallback className="text-xs bg-muted">
									{getUserInitial(user)}
								</AvatarFallback>
							</Avatar>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-48">
							<DropdownMenuLabel>
								<div className="flex flex-col">
									<span className="text-sm font-medium">
										{user?.display_name || user?.username}
									</span>
									<span className="text-xs text-muted-foreground font-normal capitalize">
										{user?.role}
									</span>
								</div>
							</DropdownMenuLabel>
							<DropdownMenuSeparator />
							<DropdownMenuItem render={<Link to="/profile" />}>
								<User className="size-4 mr-2" />
								Profile
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								onClick={() => {
									logout();
								}}
							>
								<LogOut className="size-4 mr-2" />
								Sign out
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</header>

			{/* ── Page content ─────────────────────────────────────── */}
			<main
				className="min-h-0 overflow-auto pb-[var(--kb-inset,0px)]"
				style={{ gridArea: AREAS.content }}
			>
				{backendStatus === "disconnected" && (
					<div
						role="status"
						className="h-8 flex items-center gap-1.5 px-3 sticky top-0 z-40 bg-destructive/10 border-b border-destructive/40 text-destructive text-xs font-medium"
					>
						<Radio className="size-3.5 shrink-0" />
						<span className="truncate">
							Server unreachable — reconnecting… You'll be signed out if
							this lasts more than a minute.
						</span>
					</div>
				)}
				<Outlet />
			</main>

			<nav
				aria-label="Primary"
				data-testid="bottom-tab-bar"
				className="md:hidden flex items-stretch border-t bg-background/95 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]"
				style={{ gridArea: AREAS.tabbar }}
			>
				{mobileTabs.map((tab) => {
					const active = tab.match(location.pathname);
					const Icon = tab.icon;
					return (
						<Link
							key={tab.label}
							to={tab.to}
							data-testid={`bottom-tab-${tab.label.toLowerCase()}`}
							aria-current={active ? "page" : undefined}
							className="flex-1 flex flex-col items-center justify-center gap-0.5 min-h-11 py-1 text-micro font-medium"
						>
							<Icon className={active ? "size-5 text-foreground" : "size-5 text-muted-foreground"} />
							<span className={active ? "text-foreground" : "text-muted-foreground"}>
								{tab.label}
							</span>
						</Link>
					);
				})}
			</nav>

			{/* ── Floating network monitor ─────────────────────────── */}
			<NetworkStatusTracker />
			<NetworkMonitor
				open={netOpen}
				onClose={() => setNetOpen(false)}
				defaultPos={netPos}
			/>
			<CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
		</div>
	);
}
