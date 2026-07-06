import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useAuthStore } from "@/stores/auth-store";
import { ThemeToggle } from "@/components/theme-toggle";
import { Logo } from "@/components/logo";

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
        <div className="min-h-screen flex flex-col bg-background">
            <header className="flex items-center justify-between px-6 py-4">
                <Logo className="text-lg" />
                <ThemeToggle />
            </header>
            <main className="flex-1 flex items-center justify-center px-4">
                <Outlet />
            </main>
        </div>
    );
}
