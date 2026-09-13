import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import { useEffect } from "react";
import { toast } from "sonner";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { onRateLimited } from "@/lib/api";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 30_000,
			retry: 1,
		},
	},
});

export interface RouterContext {
	auth: {
		isAuthenticated: boolean;
		userRole: string | null;
	};
}

export const Route = createRootRouteWithContext<RouterContext>()({
	component: RootComponent,
});

function RootComponent() {
	useEffect(() => {
		onRateLimited(() =>
			toast.warning("Too many requests — pausing for 60s"),
		);
	}, []);
	return (
		<ThemeProvider
			attribute="class"
			defaultTheme="dark"
			enableSystem
			disableTransitionOnChange
		>
			<QueryClientProvider client={queryClient}>
				<TooltipProvider>
					<ErrorBoundary>
						<Outlet />
					</ErrorBoundary>
					<Toaster
						richColors
						position="bottom-right"
						mobileOffset={{ bottom: "calc(env(safe-area-inset-bottom) + 56px)" }}
						offset={{ bottom: 24, right: 24 }}
					/>
				</TooltipProvider>
			</QueryClientProvider>
		</ThemeProvider>
	);
}
