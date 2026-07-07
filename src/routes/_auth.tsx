import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useAuthStore } from "@/stores/auth-store";
import { ThemeToggle } from "@/components/theme-toggle";
import { Logo } from "@/components/logo";
import { AUTH_LAYOUT, AREAS } from "@/lib/layouts";

export const Route = createFileRoute("/_auth")({
    beforeLoad: () => {
        const { isAuthenticated } = useAuthStore.getState();
        if (isAuthenticated) {
            throw redirect({ to: "/" });
        }
    },
    component: AuthLayout,
});

function AuthLayout() {
    return (
        <div className="min-h-screen bg-background" style={AUTH_LAYOUT.style}>
            <header className="flex items-center justify-between px-6 py-4" style={{ gridArea: AREAS.header }}>
                <Logo className="text-lg" />
                <ThemeToggle />
            </header>
            <main className="flex items-center justify-center px-4" style={{ gridArea: AREAS.content }}>
                <Outlet />
            </main>
        </div>
    );
}
