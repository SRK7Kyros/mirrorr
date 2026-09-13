import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { ErrorBanner, SuccessBanner } from "@/components/error-banner";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { authApi, ApiError } from "@/lib/api";
import { setActiveTokens } from "@/lib/token-store";
import { registerSchema } from "@/lib/schemas";
import { useAuthStore } from "@/stores/auth-store";

export const Route = createFileRoute("/_auth/register")({
	component: RegisterPage,
});

function RegisterPage() {
	const navigate = useNavigate();
	const setAuth = useAuthStore((s) => s.setAuth);
	const queryClient = useQueryClient();
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	const { data: authStatus, isLoading: statusLoading } = useQuery({
		queryKey: ["auth-status"],
		queryFn: () => authApi.status(),
	});

	const isFirstUser = authStatus ? !authStatus.has_users : false;

	const form = useForm({
		resolver: zodResolver(registerSchema),
		defaultValues: { username: "", password: "", display_name: "" },
	});

	const registerMutation = useMutation({
		mutationFn: (data: {
			username: string;
			password: string;
			display_name?: string;
		}) => authApi.register(data),
		onSuccess: async (data) => {
			if ("user" in data) {
				if (data.access_token) {
					await setActiveTokens({
						access: data.access_token,
						refresh: data.refresh_token ?? "",
					});
				}
				setAuth(data.user);
				// Clear the auth-status cache so the register page doesn't
				// show a stale "first user" state on next visit.
				queryClient.clear();
				navigate({ to: "/" });
			} else {
				setSuccess("Request sent — an admin will approve you");
			}
		},
		onError: (err: Error) => {
			const msg = err.message || "Registration failed";
			if (err instanceof ApiError && err.rule === "registration-dedupe") {
				setError("Request already pending — an admin will approve you");
			} else if (
				(err instanceof ApiError && err.rule === "registration-collision") ||
				msg.toLowerCase().includes("already exists")
			) {
				setError("Username already exists — try signing in");
			} else {
				setError(msg);
			}
		},
	});

	if (statusLoading) {
		return (
			<Card className="w-full max-w-sm border border-border/70 shadow-[0_24px_60px_-24px_rgb(0,0,0,0.3)] dark:border-white/10 dark:bg-white/[0.03] dark:shadow-[inset_0_1px_0_rgb(255,255,255,0.08),0_24px_70px_-20px_rgb(0,0,0,0.85)] dark:ring-0 dark:ring-white/10 dark:backdrop-blur-xl">
				<CardContent className="flex items-center justify-center py-8">
					<Loader2 className="size-6 animate-spin text-muted-foreground" />
				</CardContent>
			</Card>
		);
	}

	return (
		<Card className="w-full max-w-md border border-border/70 shadow-[0_24px_60px_-24px_rgb(0,0,0,0.3)] dark:border-white/10 dark:bg-white/[0.03] dark:shadow-[inset_0_1px_0_rgb(255,255,255,0.08),0_24px_70px_-20px_rgb(0,0,0,0.85)] dark:ring-0 dark:ring-white/10 dark:backdrop-blur-xl">
			<CardHeader className="text-center">
				<CardTitle className="text-2xl font-semibold">
					{isFirstUser ? "Create Admin Account" : "Create Account"}
				</CardTitle>
				<CardDescription className="text-base">
					{isFirstUser ? "Set up the admin account" : "Request a new account"}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{success ? (
					<div className="space-y-4">
						<SuccessBanner message={success} />
						<Link to="/login">
							<Button variant="outline" className="w-full">
								Back to Login
							</Button>
						</Link>
					</div>
				) : (
					<form
						onSubmit={form.handleSubmit((data) => {
							setError(null);
							setSuccess(null);
							registerMutation.mutate(data);
						})}
						className="space-y-5"
					>
						{error && <ErrorBanner message={error} />}
						<FormField
							label="Username"
							error={form.formState.errors.username?.message}
							className="[&_label]:text-sm"
						>
							<Input
								id="username"
								placeholder="username"
								autoComplete="username"
								className="h-11 text-base md:text-base"
								{...form.register("username")}
							/>
						</FormField>
						<FormField label="Display Name" className="[&_label]:text-sm">
							<Input
								id="display_name"
								placeholder="Optional display name"
								autoComplete="name"
								className="h-11 text-base md:text-base"
								{...form.register("display_name")}
							/>
						</FormField>
						<FormField
							label="Password"
							error={form.formState.errors.password?.message}
							className="[&_label]:text-sm"
						>
							<Input
								id="password"
								type="password"
								placeholder="••••••••"
								autoComplete="new-password"
								className="h-11 text-base md:text-base"
								{...form.register("password")}
							/>
						</FormField>
						<Button
							type="submit"
							className="h-11 w-full text-base"
							disabled={registerMutation.isPending}
						>
							{registerMutation.isPending && (
								<Loader2 className="mr-2 size-4 animate-spin" />
							)}
							{isFirstUser ? "Create Admin Account" : "Request Access"}
						</Button>
						<p className="text-center text-base text-muted-foreground">
							Already have an account?{" "}
							<Link
								to="/login"
								className="text-foreground underline underline-offset-4 hover:text-foreground/80"
							>
								Sign in
							</Link>
						</p>
					</form>
				)}
			</CardContent>
		</Card>
	);
}
