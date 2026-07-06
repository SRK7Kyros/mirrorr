import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { loginSchema, type User } from "@/lib/schemas";
import { authApi, setStoredToken, setStoredRefreshToken } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/form-field";
import { ErrorBanner } from "@/components/error-banner";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";

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
            setStoredToken(data.access_token);
            if (data.refresh_token) setStoredRefreshToken(data.refresh_token);
            setAuth(data.access_token, data.user as User);
            queryClient.clear();
            navigate({ to: "/" });
        },
        onError: (err: Error) => setError(err.message || "Login failed"),
    });

    return (
        <Card className="w-full max-w-sm">
            <CardHeader className="text-center">
                <CardTitle className="text-xl">Welcome back</CardTitle>
                <CardDescription>
                    Sign in to your Mirrorr instance
                </CardDescription>
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
