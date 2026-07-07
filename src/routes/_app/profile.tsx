import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authApi } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { SectionCard } from "@/components/section-card";
import { FormField } from "@/components/form-field";
import { User, Shield, Key, UserCheck, UserX, Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { changePasswordSchema } from "@/lib/schemas";
import { toast } from "sonner";
import { cn, getUserInitial } from "@/lib/utils";
import { AREAS, PROFILE_LAYOUT } from "@/lib/layouts";
import { MetadataBar, MetadataItem, MetadataSeparator } from "@/components/metadata-bar";
import { SectionTitle } from "@/components/section-title";
import { useState } from "react";

export const Route = createFileRoute("/_app/profile")({
    component: ProfilePage,
});

function ProfilePage() {
    const user = useAuthStore((s) => s.user);
    const isAdmin = user?.role === "admin";
    const [tab, setTab] = useState<"account" | "admin">("account");

    return (
        <div className="h-full grid gap-2 p-2" style={PROFILE_LAYOUT.style}>
            {/* Sidebar */}
            <div className="flex flex-col min-h-0 bg-card border rounded-xl overflow-hidden" style={{ gridArea: AREAS.sidebar }}>
                <div className="shrink-0 px-3.5 pt-4 pb-3">
                    <h1 className="text-lg font-bold tracking-tight">
                        Profile
                    </h1>
                    <p className="text-xs text-muted-foreground/60 mt-0.5">
                        Account settings
                    </p>
                </div>
                <ScrollArea className="flex-1 min-h-0">
                    <div className="p-1.5 space-y-px">
                        <Button
                            variant="ghost"
                            size="sm"
                            className={cn(
                                "w-full justify-start text-xs font-medium",
                                tab === "account"
                                    ? "bg-muted text-foreground"
                                    : "text-muted-foreground",
                            )}
                            onClick={() => setTab("account")}
                        >
                            Account
                        </Button>
                        {isAdmin && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className={cn(
                                    "w-full justify-start text-xs font-medium",
                                    tab === "admin"
                                        ? "bg-muted text-foreground"
                                        : "text-muted-foreground",
                                )}
                                onClick={() => setTab("admin")}
                            >
                                Admin
                            </Button>
                        )}
                    </div>
                </ScrollArea>
            </div>

            {/* Detail */}
            <div className="min-h-0 overflow-auto bg-card border rounded-xl" style={{ gridArea: AREAS.content }}>
                <div className="p-5 space-y-4 max-w-2xl">
                    {tab === "account" ? <AccountSection /> : <AdminSection />}
                </div>
            </div>
        </div>
    );
}

function AccountSection() {
    const user = useAuthStore((s) => s.user);

    const { data: meData } = useQuery({
        queryKey: ["auth-me"],
        queryFn: () => authApi.me(),
    });

    const form = useForm({
        resolver: zodResolver(changePasswordSchema),
        defaultValues: {
            old_password: "",
            new_password: "",
            confirm_password: "",
        },
    });

    const passwordMutation = useMutation({
        mutationFn: (data: { old_password: string; new_password: string }) =>
            authApi.changePassword(data),
        onSuccess: () => {
            toast.success("Password changed");
            form.reset();
        },
        onError: (err: Error) => toast.error(err.message),
    });

    const displayUser = meData?.user ?? user;

    return (
        <div className="space-y-4">
            <div className="pb-4 border-b">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-foreground flex items-center justify-center shrink-0">
                        <span className="text-background font-bold text-sm">
                            {getUserInitial(displayUser)}
                        </span>
                    </div>
                    <div>
                        <h2 className="text-sm font-bold">
                            {displayUser?.display_name || displayUser?.username}
                        </h2>
                        <p className="text-xs text-muted-foreground">
                            @{displayUser?.username}
                        </p>
                    </div>
                </div>
            </div>

            <MetadataBar>
                <MetadataItem label="Role">
                    <Badge
                        variant={
                            displayUser?.role === "admin"
                                ? "default"
                                : "secondary"
                        }
                        className="text-2xs h-4 px-1.5"
                    >
                        {displayUser?.role === "admin" ? (
                            <Shield className="size-2.5 mr-0.5" />
                        ) : (
                            <User className="size-2.5 mr-0.5" />
                        )}
                        {displayUser?.role}
                    </Badge>
                </MetadataItem>
                {meData?.client && (
                    <>
                        <MetadataSeparator />
                        <MetadataItem label="Client">
                            <code className="text-foreground">
                                {meData.client.name}
                            </code>
                        </MetadataItem>
                    </>
                )}
            </MetadataBar>

            <SectionCard
                title={
                    <SectionTitle icon={Key}>Change Password</SectionTitle>
                }
            >
                <div className="p-4">
                    <form
                        onSubmit={form.handleSubmit((data) =>
                            passwordMutation.mutate({
                                old_password: data.old_password,
                                new_password: data.new_password,
                            }),
                        )}
                        className="space-y-3"
                    >
                        <FormField
                            label="Current Password"
                            error={form.formState.errors.old_password?.message}
                        >
                            <Input
                                type="password"
                                placeholder="••••••••"
                                className="h-8 text-xs"
                                {...form.register("old_password")}
                            />
                        </FormField>
                        <FormField
                            label="New Password"
                            error={form.formState.errors.new_password?.message}
                        >
                            <Input
                                type="password"
                                placeholder="••••••••"
                                className="h-8 text-xs"
                                {...form.register("new_password")}
                            />
                        </FormField>
                        <FormField
                            label="Confirm"
                            error={
                                form.formState.errors.confirm_password?.message
                            }
                        >
                            <Input
                                type="password"
                                placeholder="••••••••"
                                className="h-8 text-xs"
                                {...form.register("confirm_password")}
                            />
                        </FormField>
                        <Button
                            size="sm"
                            type="submit"
                            disabled={passwordMutation.isPending}
                            className="h-7 text-xs"
                        >
                            {passwordMutation.isPending && (
                                <Loader2 className="mr-1 size-3 animate-spin" />
                            )}
                            Update
                        </Button>
                    </form>
                </div>
            </SectionCard>
        </div>
    );
}

function AdminSection() {
    const queryClient = useQueryClient();

    const { data: users = [], isLoading: usersLoading } = useQuery({
        queryKey: ["admin-users"],
        queryFn: () => authApi.users(),
    });

    const { data: requests = [], isLoading: requestsLoading } = useQuery({
        queryKey: ["registration-requests"],
        queryFn: () => authApi.registrationRequests(),
    });

    const approveMutation = useMutation({
        mutationFn: (id: number) => authApi.approveRequest(id),
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: ["registration-requests"],
            });
            queryClient.invalidateQueries({ queryKey: ["admin-users"] });
            toast.success("Request approved");
        },
        onError: (err: Error) =>
            toast.error(`Failed to approve: ${err.message}`),
    });

    const denyMutation = useMutation({
        mutationFn: (id: number) => authApi.denyRequest(id),
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: ["registration-requests"],
            });
            toast.success("Request denied");
        },
        onError: (err: Error) => toast.error(`Failed to deny: ${err.message}`),
    });

    const deleteUserMutation = useMutation({
        mutationFn: (username: string) => authApi.deleteUser(username),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["admin-users"] });
            toast.success("User deleted");
        },
        onError: (err: Error) =>
            toast.error(`Failed to delete user: ${err.message}`),
    });

    const pendingRequests = requests.filter((r) => r.status === "pending");

    return (
        <div className="space-y-4">
            <SectionCard
                title={
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                        <Shield className="size-3" />
                        Registration Requests
                    </h3>
                }
                actions={
                    pendingRequests.length > 0 ? (
                        <Badge
                            variant="destructive"
                            className="text-[9px] h-4 px-1.5"
                        >
                            {pendingRequests.length}
                        </Badge>
                    ) : undefined
                }
            >
                {requestsLoading ? (
                    <div className="flex items-center justify-center py-8">
                        <Loader2 className="size-5 animate-spin text-muted-foreground" />
                    </div>
                ) : pendingRequests.length === 0 ? (
                    <p className="text-xs text-muted-foreground/50 py-6 text-center">
                        No pending requests
                    </p>
                ) : (
                    <div className="divide-y">
                        {pendingRequests.map((req) => (
                            <div
                                key={req.id}
                                className="flex items-center justify-between px-4 py-2.5 text-xs"
                            >
                                <div>
                                    <span className="font-medium">
                                        {req.username}
                                    </span>
                                    <span className="text-muted-foreground ml-2">
                                        {new Date(
                                            req.created_at,
                                        ).toLocaleDateString()}
                                    </span>
                                </div>
                                <div className="flex gap-1.5">
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 text-xs text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                                        onClick={() =>
                                            approveMutation.mutate(req.id)
                                        }
                                        disabled={
                                            approveMutation.isPending &&
                                            approveMutation.variables === req.id
                                        }
                                    >
                                        {approveMutation.isPending &&
                                        approveMutation.variables === req.id ? (
                                            <Loader2 className="size-3 mr-1 animate-spin" />
                                        ) : (
                                            <UserCheck className="size-3 mr-1" />
                                        )}
                                        Approve
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 text-xs text-destructive hover:bg-destructive/10"
                                        onClick={() =>
                                            denyMutation.mutate(req.id)
                                        }
                                        disabled={
                                            denyMutation.isPending &&
                                            denyMutation.variables === req.id
                                        }
                                    >
                                        {denyMutation.isPending &&
                                        denyMutation.variables === req.id ? (
                                            <Loader2 className="size-3 mr-1 animate-spin" />
                                        ) : (
                                            <UserX className="size-3 mr-1" />
                                        )}
                                        Deny
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </SectionCard>

            <SectionCard title="Users">
                {usersLoading ? (
                    <div className="flex items-center justify-center py-8">
                        <Loader2 className="size-5 animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    <div className="divide-y">
                        {users.map((u) => (
                            <div
                                key={u.id}
                                className="flex items-center justify-between px-4 py-2.5 text-xs"
                            >
                                <div className="flex items-center gap-2">
                                    <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center">
                                        <span className="text-2xs font-medium">
                                            {getUserInitial(u)}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="font-medium">
                                            {u.username}
                                        </span>
                                        <span className="text-muted-foreground ml-2">
                                            {u.display_name}
                                        </span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Badge
                                        variant={
                                            u.role === "admin"
                                                ? "default"
                                                : "secondary"
                                        }
                                        className="text-[9px] h-4 px-1.5"
                                    >
                                        {u.role}
                                    </Badge>
                                    <Button
                                        size="icon-xs"
                                        variant="ghost"
                                        onClick={() =>
                                            deleteUserMutation.mutate(
                                                u.username,
                                            )
                                        }
                                        disabled={
                                            deleteUserMutation.isPending &&
                                            deleteUserMutation.variables ===
                                                u.username
                                        }
                                    >
                                        {deleteUserMutation.isPending &&
                                        deleteUserMutation.variables ===
                                            u.username ? (
                                            <Loader2 className="size-3 animate-spin" />
                                        ) : (
                                            <UserX className="size-3 text-muted-foreground" />
                                        )}
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </SectionCard>
        </div>
    );
}
