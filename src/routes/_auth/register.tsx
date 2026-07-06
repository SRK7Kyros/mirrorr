import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { Loader2 } from "lucide-react"
import { registerSchema, type User } from "@/lib/schemas"
import { authApi, setStoredToken } from "@/lib/api"
import { useAuthStore } from "@/stores/auth-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/form-field"
import { ErrorBanner, SuccessBanner } from "@/components/error-banner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export const Route = createFileRoute("/_auth/register")({
  component: RegisterPage,
})

function RegisterPage() {
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const { data: authStatus, isLoading: statusLoading } = useQuery({
    queryKey: ["auth-status"],
    queryFn: () => authApi.status(),
  })

  const isFirstUser = authStatus ? !authStatus.has_users : false

  const form = useForm({
    resolver: zodResolver(registerSchema),
    defaultValues: { username: "", password: "", display_name: "" },
  })

  const registerMutation = useMutation({
    mutationFn: (data: { username: string; password: string; display_name?: string }) =>
      authApi.register(data),
    onSuccess: (data) => {
      if (data.access_token && data.user) {
        setStoredToken(data.access_token)
        setAuth(data.access_token, data.user as User)
        navigate({ to: "/" })
      } else if (data.status === "pending") {
        setSuccess(data.message ?? "Registration request submitted. Waiting for admin approval.")
        form.reset()
      }
    },
    onError: (err: Error) => setError(err.message || "Registration failed"),
  })

  if (statusLoading) {
    return (
      <Card className="w-full max-w-sm">
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <CardTitle className="text-xl">{isFirstUser ? "Create Admin Account" : "Create Account"}</CardTitle>
        <CardDescription>
          {isFirstUser ? "Set up the admin account" : "Request a new account"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {success ? (
          <div className="space-y-4">
            <SuccessBanner message={success} />
            <Link to="/login">
              <Button variant="outline" className="w-full">Back to Login</Button>
            </Link>
          </div>
        ) : (
          <form
            onSubmit={form.handleSubmit((data) => {
              setError(null)
              setSuccess(null)
              registerMutation.mutate(data)
            })}
            className="space-y-4"
          >
            {error && <ErrorBanner message={error} />}
            <FormField label="Username" error={form.formState.errors.username?.message}>
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
            <FormField label="Password" error={form.formState.errors.password?.message}>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                autoComplete="new-password"
                {...form.register("password")}
              />
            </FormField>
            <Button type="submit" className="w-full" disabled={registerMutation.isPending}>
              {registerMutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              {isFirstUser ? "Create Admin Account" : "Request Access"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link to="/login" className="text-foreground underline underline-offset-4 hover:text-foreground/80">
                Sign in
              </Link>
            </p>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
