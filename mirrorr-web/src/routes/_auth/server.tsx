import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
import { setActiveTokens } from "@/lib/token-store";
import {
	autoLabel,
	ensureEnvSeeded,
	getEnvServerUrl,
	getOrderedInstances,
	isServerLocked,
	useServerStore,
} from "@/lib/server";
import { useAuthStore } from "@/stores/auth-store";

export const Route = createFileRoute("/_auth/server")({
	beforeLoad: () => {
		if (isServerLocked()) {
			throw redirect({ to: "/login" });
		}
	},
	component: ServerLinkPage,
});

function ServerLinkPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const instances = useServerStore((s) => s.instances);
	const activeId = useServerStore((s) => s.activeId);
	const addServer = useServerStore((s) => s.addServer);
	const updateServer = useServerStore((s) => s.updateServer);
	const deleteServer = useServerStore((s) => s.deleteServer);
	const setActiveServer = useServerStore((s) => s.setActiveServer);
	const logout = useAuthStore((s) => s.logout);

	const setAuth = useAuthStore((s) => s.setAuth);

	const locked = isServerLocked();
	const envPreset = getEnvServerUrl();

	const [url, setUrl] = useState(envPreset && envPreset !== "/" ? envPreset : "");
	const [label, setLabel] = useState("");
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [connecting, setConnecting] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editUrl, setEditUrl] = useState("");
	const [editLabel, setEditLabel] = useState("");

	useEffect(() => {
		ensureEnvSeeded();
	}, []);

	if (locked) return null;

	const ordered = getOrderedInstances();

	const handleConnect = async () => {
		setError(null);
		const trimmed = url.trim();
		if (!trimmed) {
			setError("Enter a server URL");
			return;
		}
		if (trimmed !== "/") {
			try {
				new URL(trimmed);
			} catch {
				setError("Invalid URL — e.g. http://192.168.1.20:8000/api");
				return;
			}
		}
		addServer(trimmed, label || undefined);
		queryClient.clear();
		const credUser = username.trim();
		if (credUser && password) {
			setConnecting(true);
			try {
				const data = await authApi.login({
					username: credUser,
					password,
				});
				if (data.access_token) {
					await setActiveTokens({
						access: data.access_token,
						refresh: data.refresh_token ?? "",
					});
				}
				setAuth(data.user);
				queryClient.clear();
				navigate({ to: "/" });
			} catch (err) {
				setError(err instanceof Error ? err.message : "Sign in failed");
			} finally {
				setConnecting(false);
			}
			return;
		}
		navigate({ to: "/login" });
	};

	const handleSwitch = (id: string) => {
		logout();
		setActiveServer(id);
		queryClient.clear();
		navigate({ to: "/login" });
	};

	const handleDelete = (id: string) => {
		if (id === activeId) {
			logout();
		}
		deleteServer(id);
		queryClient.clear();
	};

	const startEdit = (id: string, curUrl: string, curLabel: string) => {
		setEditingId(id);
		setEditUrl(curUrl);
		setEditLabel(curLabel);
	};

	const saveEdit = () => {
		if (!editingId) return;
		if (!editUrl.trim()) {
			setError("URL cannot be empty");
			return;
		}
		updateServer(editingId, { url: editUrl, label: editLabel });
		setEditingId(null);
	};

	return (
		<Card className="w-full max-w-md border border-border/70 shadow-[0_24px_60px_-24px_rgb(0,0,0,0.3)] dark:border-white/10 dark:bg-white/[0.03] dark:backdrop-blur-xl">
			<CardHeader className="text-center">
				<CardTitle className="text-2xl font-semibold">Connect to server</CardTitle>
				<CardDescription className="text-base">
					{instances.length === 0
						? "First run — add your Mirrorr server"
						: "Instances — switch the active server"}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-5">
				{error && <ErrorBanner message={error} />}
				<div className="space-y-4">
					<FormField label="Server URL" className="[&_label]:text-sm">
						<Input
							id="server-url"
							placeholder="http://192.168.1.20:8000/api"
							autoComplete="url"
							enterKeyHint="next"
							className="h-11 text-base md:text-base"
							value={url}
							onChange={(e) => setUrl(e.target.value)}
						/>
					</FormField>
					<FormField label="Label (optional)" className="[&_label]:text-sm">
						<Input
							id="server-label"
							placeholder={autoLabel(url.trim() || "http://192.168.1.20:8000/api")}
							autoComplete="off"
							enterKeyHint="next"
							className="h-11 text-base md:text-base"
							value={label}
							onChange={(e) => setLabel(e.target.value)}
						/>
					</FormField>
					<FormField label="Username (optional)" className="[&_label]:text-sm">
						<Input
							id="server-username"
							placeholder="Sign in right after connect"
							autoComplete="username"
							enterKeyHint="next"
							className="h-11 text-base md:text-base"
							value={username}
							onChange={(e) => setUsername(e.target.value)}
						/>
					</FormField>
					<FormField label="Password (optional)" className="[&_label]:text-sm">
						<Input
							id="server-password"
							type="password"
							placeholder="••••••••"
							autoComplete="current-password"
							enterKeyHint="go"
							onKeyDown={(e) => {
								if (e.key === "Enter") void handleConnect();
							}}
							className="h-11 text-base md:text-base"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
						/>
					</FormField>
					<Button
						type="button"
						className="h-11 w-full text-base"
						disabled={connecting}
						onClick={handleConnect}
					>
						{username.trim() && password ? "Connect & sign in" : "Connect"}
					</Button>
				</div>
				{ordered.length > 0 && (
					<div className="space-y-2">
						{ordered.map((inst) => (
							<div
								key={inst.id}
								className="flex items-center gap-2 rounded-xl border border-border/60 px-3 py-2"
							>
								<div className="min-w-0 flex-1">
									{editingId === inst.id ? (
										<div className="space-y-2">
											<Input
												value={editUrl}
												onChange={(e) => setEditUrl(e.target.value)}
												className="h-9 text-sm"
											/>
											<Input
												value={editLabel}
												onChange={(e) => setEditLabel(e.target.value)}
												className="h-9 text-sm"
											/>
											<div className="flex gap-2">
												<Button size="sm" onClick={saveEdit}>
													Save
												</Button>
												<Button
													size="sm"
													variant="ghost"
													onClick={() => setEditingId(null)}
												>
													Cancel
												</Button>
											</div>
										</div>
									) : (
										<>
											<p className="truncate text-sm font-medium">
												{inst.label}
												{inst.id === activeId && (
													<span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-600 dark:text-emerald-400">
														active
													</span>
												)}
											</p>
											<p className="truncate text-xs text-muted-foreground">
												{inst.url}
											</p>
										</>
									)}
								</div>
								{editingId !== inst.id && (
									<div className="flex shrink-0 gap-1">
										{inst.id !== activeId && (
											<Button
												size="sm"
												variant="outline"
												onClick={() => handleSwitch(inst.id)}
											>
												Switch
											</Button>
										)}
										<Button
											size="sm"
											variant="ghost"
											onClick={() => startEdit(inst.id, inst.url, inst.label)}
										>
											Edit
										</Button>
										<Button
											size="sm"
											variant="ghost"
											onClick={() => handleDelete(inst.id)}
										>
											Delete
										</Button>
									</div>
								)}
							</div>
						))}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
