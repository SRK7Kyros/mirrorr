import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { AREAS, AUTH_LAYOUT } from "@/lib/layouts";
import { useAuthStore } from "@/stores/auth-store";

export const Route = createFileRoute("/_auth")({
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
		if (isAuthenticated) {
			throw redirect({ to: "/" });
		}
		const { useServerStore: _ss, isServerLocked: _lock } = await import("@/lib/server");
		await new Promise<void>((resolve) => {
			const unsub = _ss.persist.onFinishHydration(() => {
				unsub();
			resolve();
			});
			if (_ss.persist.hasHydrated()) {
				unsub();
			resolve();
			}
		});
		if (!_lock() && _ss.getState().instances.length === 0 && window.location.pathname !== "/server") {
			throw redirect({ to: "/server" });
		}
	},
	component: AuthLayout,
});

	function AuthLayout() {
	useKeyboardInset();
	return (
		<div className="h-svh overflow-hidden bg-background" style={AUTH_LAYOUT.style}>
			<header
				className="flex items-center justify-between px-8 py-5 pt-[calc(1.25rem+env(safe-area-inset-top))]"
				style={{ gridArea: AREAS.header }}
			>
				<Logo className="text-xl" />
				<ThemeToggle />
			</header>
			<main
				className="flex min-h-0 items-start md:items-center justify-center overflow-y-auto px-4 pb-[var(--kb-inset,0px)] pt-2 md:pt-0"
				style={{ gridArea: AREAS.content }}
			>
				<Outlet />
			</main>
		</div>
	);
}
