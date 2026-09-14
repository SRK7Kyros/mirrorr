/**
 * Universal server-link state (Todo 5).
 * One shared Instances store for ALL clients (browser + Capacitor wrapper).
 *
 * Entry: { id, url, label?, lastUsedAt }
 * - blank label auto-generates from host:
 *   `https://mirrorr.bigbro-itzamekyros.duckdns.org` -> `mirrorr.bigbro-itzamekyros.duckdns.org (prod)`
 *   `http://192.168.1.20:8000` -> `192.168.1.20 (lan)`
 * - active instance marked; list ordered by lastUsedAt desc.
 * - web `.env` VITE_MIRRORR_SERVER_URL pre-fills / seeds; VITE_MIRRORR_SERVER_LOCKED=true
 *   hides the screen + fixates. Native ignores `.env` after first save (instances win).
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ServerInstance {
	id: string;
	url: string;
	label: string;
	lastUsedAt: number;
}

interface ServerState {
	instances: ServerInstance[];
	activeId: string | null;
	addServer: (url: string, label?: string) => ServerInstance;
	updateServer: (id: string, patch: { url?: string; label?: string }) => void;
	deleteServer: (id: string) => void;
	setActiveServer: (id: string) => void;
}

/** Normalize a server root URL: trim + strip trailing slashes. */
export function normalizeServerUrl(url: string): string {
	return url.trim().replace(/\/+$/, "") || "/";
}

/** Auto-label from host. LAN (RFC1918/localhost) -> `(lan)`, else `(prod)`. */
export function autoLabel(rawUrl: string): string {
	const trimmed = rawUrl.trim();
	try {
		const u = new URL(trimmed);
		const host = u.hostname;
		const isLan =
			host === "localhost" ||
			host === "127.0.0.1" ||
			host === "::1" ||
			/^192\.168\./.test(host) ||
			/^10\./.test(host) ||
			/^172\.(1[6-9]|2\d|3[01])\./.test(host);
		return `${host}${isLan ? " (lan)" : " (prod)"}`;
	} catch {
		return trimmed || "server";
	}
}

function newId(): string {
	try {
		return crypto.randomUUID();
	} catch {
		return `srv-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
	}
}

/** Raw env values. `/` means same-origin explicitly. */
export function getEnvServerUrl(): string | undefined {
	const v = import.meta.env.VITE_MIRRORR_SERVER_URL as string | undefined;
	if (v !== undefined && v !== "") return v;
	return undefined;
}

export function isServerLocked(): boolean {
	return (
		(import.meta.env.VITE_MIRRORR_SERVER_LOCKED as string | undefined) ===
		"true"
	);
}

/** Legacy fallback: VITE_API_URL treated as an API base. */
function getLegacyApiBase(): string | undefined {
	const v = import.meta.env.VITE_API_URL as string | undefined;
	if (v !== undefined && v !== "") return v.replace(/\/+$/, "");
	return undefined;
}

/** Env-derived API base: SERVER_URL wins, then legacy API_URL, then `/api`. */
export function getEnvApiBase(): string {
	const env = getEnvServerUrl();
	if (env !== undefined) {
		if (env.trim() === "/") return "/api";
		return normalizeServerUrl(env);
	}
	return getLegacyApiBase() ?? "/api";
}

/** Append `/api` to an absolute server root (idempotent; leaves `/api` bases alone). */
function withApiPrefix(root: string): string {
	if (/^https?:\/\//.test(root)) {
		return root.endsWith("/api") ? root : `${root}/api`;
	}
	return root;
}

export const useServerStore = create<ServerState>()(
	persist(
		(set) => ({
			instances: [],
			activeId: null,
			addServer: (url, label) => {
				const normalized = normalizeServerUrl(url);
				const entry: ServerInstance = {
					id: newId(),
					url: normalized,
					label:
						label?.trim() || autoLabel(normalized === "/" ? "" : normalized),
					lastUsedAt: Date.now(),
				};
				set((s) => ({
					instances: [entry, ...s.instances],
					activeId: entry.id,
				}));
				return entry;
			},
			updateServer: (id, patch) =>
				set((s) => ({
					instances: s.instances.map((i) =>
						i.id === id
							? {
									...i,
									url: patch.url ? normalizeServerUrl(patch.url) : i.url,
									label: patch.label?.trim() || i.label,
								}
							: i,
					),
				})),
			deleteServer: (id) =>
				set((s) => {
					const instances = s.instances.filter((i) => i.id !== id);
					const activeId =
						s.activeId === id ? (instances[0]?.id ?? null) : s.activeId;
					return { instances, activeId };
				}),
			setActiveServer: (id) =>
				set((s) => ({
					activeId: id,
					instances: s.instances.map((i) =>
						i.id === id ? { ...i, lastUsedAt: Date.now() } : i,
					),
				})),
		}),
		{
			name: "mirrorr-servers",
			partialize: (s) => ({ instances: s.instances, activeId: s.activeId }),
		},
	),
);

/** Seed one instance from `.env` on first run (web only, ignored once saved). */
export function ensureEnvSeeded(): void {
	try {
		const { instances } = useServerStore.getState();
		if (instances.length > 0) return;
		const env = getEnvServerUrl();
		if (env === undefined || env.trim() === "" || env.trim() === "/") return;
		useServerStore.getState().addServer(env);
	} catch {
		// storage unavailable — server-link still works for this session
	}
}

/** Active instance (null when none). */
export function getActiveInstance(): ServerInstance | null {
	const { instances, activeId } = useServerStore.getState();
	return instances.find((i) => i.id === activeId) ?? null;
}

/** Instances ordered by lastUsedAt desc (active first on ties). */
export function getOrderedInstances(): ServerInstance[] {
	const { instances, activeId } = useServerStore.getState();
	return [...instances].sort((a, b) => {
		if (a.id === activeId && b.id !== activeId) return -1;
		if (b.id === activeId && a.id !== activeId) return 1;
		return b.lastUsedAt - a.lastUsedAt;
	});
}

/**
 * Resolve the API base for fetch calls.
 * Locked -> env fixated. Unlocked with saved instances -> active instance
 * (server root; `_fetchJson` appends paths, nginx strips `/api`).
 * Otherwise env (SERVER_URL > API_URL > `/api`).
 */
export function getApiBase(): string {
	if (isServerLocked()) return withApiPrefix(getEnvApiBase());
	const active = getActiveInstance();
	if (active) return withApiPrefix(normalizeServerUrl(active.url));
	return withApiPrefix(getEnvApiBase());
}

/** Resolve the server root for display (API base minus a trailing `/api`). */
export function getServerRoot(): string {
	const base = getApiBase();
	if (base === "/api") return "/";
	return base.replace(/\/api$/, "");
}

/** Build a WS URL from the resolved API base (SERVER_URL-derived host). */
export function buildServerWsUrl(path: string): string {
	const base = getApiBase();
	if (/^https?:\/\//.test(base)) {
		const wsBase = base.replace(/^http/, "ws");
		// Strip a trailing `/api` prefix — WS endpoints live at server root.
		const root = wsBase.replace(/\/api$/, "");
		return `${root}${path}`;
	}
	const proto =
		typeof window !== "undefined" && window.location.protocol === "https:"
			? "wss:"
			: "ws:";
	const host =
		typeof window !== "undefined" ? window.location.host : "localhost:8000";
	return `${proto}//${host}${path}`;
}
