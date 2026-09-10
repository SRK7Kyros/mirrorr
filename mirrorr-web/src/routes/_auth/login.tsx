import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { ErrorBanner } from "@/components/error-banner";
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
import { loginSchema } from "@/lib/schemas";
import { useAuthStore } from "@/stores/auth-store";

export const Route = createFileRoute("/_auth/login")({
	component: LoginPage,
});

function LoginPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const setAuth = useAuthStore((s) => s.setAuth);
	const [error, setError] = useState<string | null>(null);

	const form = useForm({
		resolver: zodResolver(loginSchema),
		defaultValues: { username: "", password: "" },
	});

	const loginMutation = useMutation({
		mutationFn: (data: { username: string; password: string }) =>
			authApi.login(data),
		onSuccess: (data) => {
			// Tokens are now in httpOnly cookies — just store user info
			setAuth(data.user);
			queryClient.clear();
			navigate({ to: "/" });
		},
		onError: (err: Error) => setError(err.message || "Login failed"),
	});

	return (
		<Card className="w-full max-w-sm border border-border/70 shadow-[0_24px_60px_-24px_rgb(0,0,0,0.3)] dark:border-white/25 dark:bg-white/[0.09] dark:shadow-[inset_0_1px_0_rgb(255,255,255,0.2),0_24px_70px_-20px_rgb(0,0,0,0.85)] dark:ring-0 dark:ring-white/10 dark:backdrop-blur-xl">
			<CardHeader className="text-center">
				<CardTitle className="text-xl">Welcome back</CardTitle>
				<CardDescription>Sign in to your Mirrorr instance</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					onSubmit={form.handleSubmit((data) => {
						setError(null);
						loginMutation.mutate(data);
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
					<FormField
						label="Password"
						error={form.formState.errors.password?.message}
					>
						<Input
							id="password"
							type="password"
							placeholder="••••••••"
							autoComplete="current-password"
							{...form.register("password")}
						/>
					</FormField>
					<Button
						type="submit"
						className="w-full"
						disabled={loginMutation.isPending}
					>
						{loginMutation.isPending && (
							<Loader2 className="mr-2 size-4 animate-spin" />
						)}
						Sign In
					</Button>
					<p className="text-center text-sm text-muted-foreground">
						Don&apos;t have an account?{" "}
						<Link
							to="/register"
							className="text-foreground underline underline-offset-4 hover:text-foreground/80"
						>
							Register
						</Link>
					</p>
				</form>
			</CardContent>
		</Card>
	);
}
