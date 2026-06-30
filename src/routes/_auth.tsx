import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"
import { useAuthStore } from "@/stores/auth-store"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import { Moon, Sun } from "lucide-react"

export const Route = createFileRoute("/_auth")({
  beforeLoad: () => {
    const { isAuthenticated } = useAuthStore.getState()
    if (isAuthenticated) {
      throw redirect({ to: "/" })
    }
  },
  component: AuthLayout,
})

function AuthLayout() {
  const { theme, setTheme } = useTheme()

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Minimal top bar */}
      <header className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-foreground flex items-center justify-center">
            <span className="text-background font-bold text-sm">M</span>
          </div>
          <span className="text-lg font-semibold tracking-tight">Mirrorr</span>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          <Sun className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </header>

      {/* Centered content */}
      <main className="flex-1 flex items-center justify-center px-4">
        <Outlet />
      </main>
    </div>
  )
}
