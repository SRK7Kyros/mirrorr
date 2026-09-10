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
import { authApi } from "@/lib/api";
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
		onSuccess: (data) => {
			if (data.user) {
				// Tokens are now in httpOnly cookies — just store user info
				setAuth(data.user);
				// Clear the auth-status cache so the register page doesn't
				// show a stale "first user" state on next visit.
				queryClient.clear();
				navigate({ to: "/" });
			}
		},
		onError: (err: Error) => setError(err.message || "Registration failed"),
	});

	if (statusLoading) {
		return (
			<Card className="w-full max-w-sm border-border/60 shadow-lg dark:border-white/10 dark:bg-gradient-to-b dark:from-white/[0.08] dark:to-white/[0.02] dark:ring-1 dark:ring-white/10 dark:backdrop-blur-xl">
				<CardContent className="flex items-center justify-center py-8">
					<Loader2 className="size-6 animate-spin text-muted-foreground" />
				</CardContent>
			</Card>
		);
	}

	return (
		<Card className="w-full max-w-sm border-border/60 shadow-[0_8px_30px_rgb(0,0,0,0.06),0_20px_60px_-20px_rgb(0,0,0,0.25)] ring-1 ring-black/[0.04] dark:border-white/10 dark:bg-gradient-to-b dark:from-white/[0.08] dark:to-white/[0.02] dark:shadow-[0_8px_40px_rgb(0,0,0,0.45),0_24px_80px_-20px_rgb(0,0,0,0.9)] dark:ring-white/10 dark:backdrop-blur-xl">
			<CardHeader className="text-center">
				<CardTitle className="text-xl">
					{isFirstUser ? "Create Admin Account" : "Create Account"}
				</CardTitle>
				<CardDescription>
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
						className="space-y-4"
					>
						{error && <ErrorBanner message={error} />}
						<FormField
							label="Username"
							error={form.formState.errors.username?.message}
						>
							<Input
								id="username"
								placeholder="username"
								autoComplete="username"
								{...form.register("username")}
							/>
						</FormField>
						<FormField label="Display Name">
							<Input
								id="display_name"
								placeholder="Optional display name"
								autoComplete="name"
								{...form.register("display_name")}
							/>
						</FormField>
						<FormField
							label="Password"
							error={form.formState.errors.password?.message}
						>
							<Input
								id="password"
								type="password"
								placeholder="••••••••"
								autoComplete="new-password"
								{...form.register("password")}
							/>
						</FormField>
						<Button
							type="submit"
							className="w-full"
							disabled={registerMutation.isPending}
						>
							{registerMutation.isPending && (
								<Loader2 className="mr-2 size-4 animate-spin" />
							)}
							{isFirstUser ? "Create Admin Account" : "Request Access"}
						</Button>
						<p className="text-center text-sm text-muted-foreground">
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
