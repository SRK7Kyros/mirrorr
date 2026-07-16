import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Key, Loader2, Shield, User, UserX } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormField } from "@/components/form-field";
import {
	MetadataBar,
	MetadataItem,
	MetadataSeparator,
} from "@/components/metadata-bar";
import { SectionCard } from "@/components/section-card";
import { SectionTitle } from "@/components/section-title";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { authApi } from "@/lib/api";
import { AREAS, PROFILE_LAYOUT } from "@/lib/layouts";
import { changePasswordSchema } from "@/lib/schemas";
import { cn, getUserInitial } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { DeleteConfirm } from "@/components/delete-confirm";

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
			<div
				className="flex flex-col min-h-0 bg-card border rounded-xl overflow-hidden"
				style={{ gridArea: AREAS.sidebar }}
			>
				<div className="shrink-0 px-3.5 pt-4 pb-3">
					<h1 className="text-lg font-bold tracking-tight">Profile</h1>
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
			<div
				className="min-h-0 overflow-auto bg-card border rounded-xl"
				style={{ gridArea: AREAS.content }}
			>
				<div className="p-5 space-y-4 max-w-2xl">
					{tab === "account" ? <AccountSection /> : <AdminSection />}
				</div>
			</div>
		</div>
	);
}

function AccountSection() {
	const queryClient = useQueryClient();
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
			queryClient.invalidateQueries({ queryKey: ["auth-me"] });
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
						variant={displayUser?.role === "admin" ? "default" : "secondary"}
						className="text-[10px] h-4 px-1.5"
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
							<code className="text-foreground">{meData.client.name}</code>
						</MetadataItem>
					</>
				)}
			</MetadataBar>

			<SectionCard
				title={<SectionTitle icon={Key}>Change Password</SectionTitle>}
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
							error={form.formState.errors.confirm_password?.message}
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

	const deleteUserMutation = useMutation({
		mutationFn: (username: string) => authApi.deleteUser(username),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin-users"] });
			toast.success("User deleted");
		},
		onError: (err: Error) =>
			toast.error(`Failed to delete user: ${err.message}`),
	});

	return (
		<div className="space-y-4">
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
										<span className="text-[10px] font-medium">
											{getUserInitial(u)}
										</span>
									</div>
									<div>
										<span className="font-medium">{u.username}</span>
										<span className="text-muted-foreground ml-2">
											{u.display_name}
										</span>
									</div>
								</div>
								<div className="flex items-center gap-2">
									<Badge
										variant={u.role === "admin" ? "default" : "secondary"}
										className="text-[9px] h-4 px-1.5"
									>
										{u.role}
									</Badge>
									<DeleteConfirm
										entityName={`user "${u.username}"`}
										isPending={
											deleteUserMutation.isPending &&
											deleteUserMutation.variables === u.username
										}
										onConfirm={() => deleteUserMutation.mutate(u.username)}
									>
										<Button
											size="icon-xs"
											variant="ghost"
											disabled={
												deleteUserMutation.isPending &&
												deleteUserMutation.variables === u.username
											}
										>
											{deleteUserMutation.isPending &&
											deleteUserMutation.variables === u.username ? (
												<Loader2 className="size-3 animate-spin" />
											) : (
												<UserX className="size-3 text-muted-foreground" />
											)}
										</Button>
									</DeleteConfirm>
								</div>
							</div>
						))}
					</div>
				)}
			</SectionCard>
		</div>
	);
}
