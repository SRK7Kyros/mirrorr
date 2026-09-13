/**
 * API client for mirrorr-core backend.
 * Thin fetch wrapper with automatic auth header injection.
 */

import {
	type AuthResponse,
	type RegisterResponse,
	type RegistrationRequest,
	type Autorun,
	type ControlResponse,
	type Engine,
	type ImportBundle,
	type Notification,
	type Profile,
	type Recording,
	type Resolver,
	type Session,
	type ValidationReport,
	type UpdateAutorunPayload,
	type ApplyResponse,
	authResponseSchema,
	registerResponseSchema,
	registrationRequestSchema,
	authStatusSchema,
	autorunSchema,
	controlResponseSchema,
	engineSchema,
	importBundleSchema,
	notificationSchema,
	profileSchema,
	recordingSchema,
	resolverSchema,
	sessionSchema,
	userSchema,
	validationReportSchema,
	updateAutorunSchema,
	applyResponseSchema,
	deleteResultSchema,
	sessionLogsSchema,
	type DeleteResult,
	type SessionLogs,
	type RecordingProgressResponse,
	recordingProgressResponseSchema,
} from "@/lib/schemas";
import { z } from "zod";
import {
	clearStoredRefreshToken,
	clearStoredToken,
	getStoredApiKey,
	getStoredRefreshToken,
	getStoredToken,
	setStoredApiKey,
	setStoredRefreshToken,
	setStoredToken,
} from "@/lib/storage";
import { useAuthStore } from "@/stores/auth-store";
import { useRequestLogStore } from "@/stores/request-log-store";
import { buildServerWsUrl, getApiBase } from "@/lib/server";
import {
	getActiveTokens,
	getBearerForActive,
	setActiveTokens,
} from "@/lib/token-store";

// Re-export storage helpers for backward compatibility
export {
	clearStoredRefreshToken,
	clearStoredToken,
	getStoredApiKey,
	getStoredRefreshToken,
	getStoredToken,
	setStoredApiKey,
	setStoredRefreshToken,
	setStoredToken,
};

// Resolved per request (NOT a module constant): locked build -> env fixated,
// unlocked with saved Instances -> active instance, else env fallback.
// Example: active `http://192.168.1.20:8000` -> `http://192.168.1.20:8000/auth/me`;
// same-origin fallback -> `/api/auth/me`.

// ── Request log body truncation ───────────────────────────────────

/** Maximum bytes of request/response body to store in the request log.
 *  Prevents memory bloat from large list responses (200 entries × multi-MB). */
const MAX_LOG_BODY_BYTES = 10_000;

/** Truncate a string to approximately MAX_LOG_BODY_BYTES with a marker. */
function truncateForLog(value: string | null): string | null {
	if (value === null) return null;
	if (value.length <= MAX_LOG_BODY_BYTES) return value;
	return `${value.slice(0, MAX_LOG_BODY_BYTES)}…truncated (${value.length} chars)`;
}

// ── Rate-limit backoff state ─────────────────────────────────────

// Fixed-window backoff: the core sends plain 429 `detail` with NO
// `Retry-After` header (auth.py), so the client uses a fixed window.
const RATE_LIMIT_WINDOW_MS = 60_000;

let rateLimitedUntil = 0;
let rateLimitToastShown = false;
let notifyRateLimited: (() => void) | null = null;

/** Register the single-shot rate-limit toast (wired once from app code). */
export function onRateLimited(cb: () => void) {
	notifyRateLimited = cb;
}

/** True while the client is pausing outbound calls after a 429. */
export function isRateLimited(): boolean {
	if (Date.now() >= rateLimitedUntil) {
		rateLimitToastShown = false;
		return false;
	}
	return true;
}

/** Mark the client rate-limited and fire the single backoff toast. */
function noteRateLimited() {
	rateLimitedUntil = Date.now() + RATE_LIMIT_WINDOW_MS;
	if (!rateLimitToastShown) {
		rateLimitToastShown = true;
		notifyRateLimited?.();
	}
}

// ── Paginated response helpers ──────────────────────────────────

/**
 * Create a Zod schema that validates a paginated API response.
 * Wraps any entity schema into { items: schema[], next_cursor, has_more }.
 */
function paginatedSchema<T extends z.ZodType>(itemSchema: T) {
	return z.object({
		items: z.array(itemSchema),
		next_cursor: z.number().nullable(),
		has_more: z.boolean(),
		total: z.number().nullable().optional(),
	});
}

/** Unwrap a paginated API response into just the items array. */
async function fetchList<T>(
	path: string,
	itemSchema?: z.ZodType,
): Promise<T[]> {
	if (itemSchema) {
		const res = await apiRequest(path, {
			schema: paginatedSchema(itemSchema),
		});
		return (res as { items: T[] }).items;
	}
	return (await apiRequest<{ items: T[] }>(path)).items;
}

// ── Auth failure callback (set by auth-store to avoid circular dep) ─

// `var` instead of `let` to avoid TDZ — auth-store.ts calls onAuthFailed()
// at module evaluation time (line 61), which races with this module's
// initialization due to the circular dependency: api.ts → auth-store → api.ts.
// By the time onAuthFailed() runs, the hoisted function declaration is ready,
// but a `let` binding at line ~107 would still be in the temporal dead zone.
// `var` is hoisted + initialized to `undefined`, so the assignment succeeds.
// eslint-disable-next-line no-var
var _onAuthFailed: (() => void) | null = null;

/** Called by auth-store to register a logout callback for refresh failures. */
export function onAuthFailed(cb: () => void) {
	_onAuthFailed = cb;
}

// ── Core request function ──────────────────────────────────────────

export class ApiError extends Error {
	status: number;
	detail: string;
	rule?: string;
	errors?: unknown;

	constructor(status: number, detail: string, opts?: { rule?: string; errors?: unknown }) {
		super(detail);
		this.name = "ApiError";
		this.status = status;
		this.detail = detail;
		if (opts?.rule) this.rule = opts.rule;
		if (opts?.errors !== undefined) this.errors = opts.errors;
	}
}

type RequestOptions = {
	method?: string;
	body?: unknown;
	params?: Record<string, string | number | boolean | undefined>;
	headers?: Record<string, string>;
	/** Skip auth headers (for bootstrap endpoints). */
	noAuth?: boolean;
	/** Zod schema to validate the response at runtime. */
	schema?: z.ZodType;
};

async function _fetchJson<T = unknown>(
	path: string,
	options: RequestOptions = {},
): Promise<T> {
	const {
		method = "GET",
		body,
		params,
		headers = {},
		noAuth = false,
	} = options;

	// Build the URL by string concatenation (NOT `new URL(path, base)`).
	// `new URL` treats `path` as absolute and silently drops any sub-path in
	// the base — so a `/api`-prefixed base (e.g. `https://host/api`) would
	// lose its prefix and hit the wrong route. Concatenation preserves it.
	const base = getApiBase().replace(/\/+$/, "") || "/api";
	const urlPath = path.startsWith("/") ? path : `/${path}`;
	let urlStr = `${base}${urlPath}`;

	if (params) {
		const usp = new URLSearchParams();
		for (const [key, value] of Object.entries(params)) {
			if (value !== undefined && value !== null) {
				usp.set(key, String(value));
			}
		}
		const qs = usp.toString();
		if (qs) urlStr += (urlStr.includes("?") ? "&" : "?") + qs;
	}

	const fetchHeaders: Record<string, string> = {
		"Content-Type": "application/json",
		...headers,
	};

	// API key is still sent as a header (not a secret, identifies the app)
	if (!noAuth) {
		const apiKey = getStoredApiKey();
		if (apiKey) {
			fetchHeaders["X-API-Key"] = apiKey;
		}
		if (!fetchHeaders["Authorization"]) {
			const bearer = await getBearerForActive();
			if (bearer) {
				fetchHeaders["Authorization"] = `Bearer ${bearer}`;
			}
		}
	}

	// Log the request
	const logEntry = {
		type: "http" as const,
		timestamp: Date.now(),
		method,
		url: urlStr,
		path,
		status: null as number | null,
		statusText: "pending",
		duration: null as number | null,
		ok: null as boolean | null,
		error: null as string | null,
		requestBody: truncateForLog(
			body ? (typeof body === "string" ? body : JSON.stringify(body)) : null,
		),
		responseBody: null as string | null,
	};
	const logId = useRequestLogStore.getState().addEntry(logEntry);
	const startTime = Date.now();

	try {
		const res = await fetch(urlStr, {
			method,
			headers: fetchHeaders,
			body: body ? JSON.stringify(body) : undefined,
			credentials: "include", // Send httpOnly cookies with every request
		});

		const duration = Date.now() - startTime;
		let detail = res.statusText;
		let responseBody: string | null = null;

		if (!res.ok) {
			let rule: string | undefined;
			let errors: unknown;
			try {
				const errBody = await res.json();
				const rawDetail = errBody.detail ?? errBody.message;
				if (Array.isArray(rawDetail)) {
					errors = rawDetail;
					const msgs = rawDetail.map((item: unknown) =>
						typeof item === "string"
							? item
							: typeof item === "object" && item !== null && "msg" in item
								? String((item as { msg: unknown }).msg)
								: JSON.stringify(item),
					);
					detail = msgs.join("; ") || detail;
				} else if (
					typeof rawDetail === "object" &&
					rawDetail !== null
				) {
					const nested = rawDetail as { detail?: unknown; rule?: unknown };
					if (typeof nested.detail === "string") detail = nested.detail;
					if (typeof nested.rule === "string") rule = nested.rule;
				} else if (typeof rawDetail === "string") {
					detail = rawDetail;
				}
				if (typeof errBody.rule === "string") rule = errBody.rule;
				if (errBody.errors !== undefined) errors = errBody.errors;
				responseBody = JSON.stringify(errBody);
			} catch {
				// Fall back to raw text if JSON parsing fails
				try {
					const textBody = await res.text();
					if (textBody) {
						detail = textBody;
						responseBody = textBody;
					}
				} catch {
					// ignore read error
				}
			}
			useRequestLogStore.getState().updateEntry(logId, {
				status: res.status,
				statusText: detail,
				duration,
				ok: false,
				error: detail,
				responseBody,
			});
			if (res.status === 429) noteRateLimited();
			throw new ApiError(res.status, detail, { rule, errors });
		}

		// 204 No Content
		if (res.status === 204) {
			useRequestLogStore.getState().updateEntry(logId, {
				status: 204,
				statusText: "No Content",
				duration,
				ok: true,
			});
			return undefined as T;
		}

		const raw = await res.json();

		// Runtime validation: if a Zod schema is provided, parse the response.
		// This catches backend/frontend contract mismatches that `as T` silently ignores.
		let data: T;
		if (options.schema) {
			const parsed = options.schema.safeParse(raw);
			if (!parsed.success) {
				const errMsg = `API response validation failed for ${path}: ${parsed.error.message}`;
				useRequestLogStore.getState().updateEntry(logId, {
					status: res.status,
					statusText: errMsg,
					duration,
					ok: false,
					error: errMsg,
					responseBody: truncateForLog(JSON.stringify(raw)),
				});
				throw new ApiError(res.status, errMsg);
			}
			data = parsed.data as T;
		} else {
			data = raw as T;
		}

		useRequestLogStore.getState().updateEntry(logId, {
			status: res.status,
			statusText: res.statusText,
			duration,
			ok: true,
			responseBody: truncateForLog(JSON.stringify(data)),
		});
		return data;
	} catch (err) {
		const duration = Date.now() - startTime;
		if (err instanceof ApiError) throw err;
		useRequestLogStore.getState().updateEntry(logId, {
			status: 0,
			statusText: "Network Error",
			duration,
			ok: false,
			error: err instanceof Error ? err.message : "Network error",
		});
		throw err;
	}
}

/** Core fetch with automatic 401 refresh-and-retry. */
export async function apiRequest<T = unknown>(
	path: string,
	options: RequestOptions = {},
): Promise<T> {
	try {
		return await _fetchJson<T>(path, options);
	} catch (err) {
		if (err instanceof ApiError && err.status === 401 && !options.noAuth) {
			await refreshAccessToken();
			const retryHeaders: Record<string, string> = { ...(options.headers ?? {}) };
			const bearer = await getBearerForActive();
			if (bearer) {
				retryHeaders["Authorization"] = `Bearer ${bearer}`;
			}
			return await _fetchJson<T>(path, {
				...options,
				headers: retryHeaders,
			});
		}
		throw err;
	}
}

// ── Token refresh ────────────────────────────────────────────────

let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
	// Deduplicate concurrent refresh attempts
	if (refreshPromise) return refreshPromise;

	refreshPromise = (async () => {
		const activePair = await getActiveTokens();
		const refreshToken = activePair?.refresh || getStoredRefreshToken();

		const body: Record<string, string> = {};
		if (refreshToken) {
			body.refresh_token = refreshToken;
		}

		const res = await fetch(`${getApiBase()}/auth/refresh`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			credentials: "include",
		});

		if (!res.ok) throw new Error(`Refresh failed (status ${res.status})`);

		// Cookie-based auth: backend sets new cookies via Set-Cookie headers
		// We no longer receive tokens in the response body
		const data = (await res.json()) as AuthResponse;

		if (data.access_token) {
			await setActiveTokens({
				access: data.access_token,
				refresh: data.refresh_token ?? activePair?.refresh ?? "",
			});
		}

		// Update the zustand store with user info (cookies handle auth)
		const authStore = useAuthStore.getState();
		if (data.user) {
			authStore.setAuth(data.user);
		}

		// Return a placeholder — actual auth is via cookies
		return "cookie";
	})()
		.catch((err) => {
			// Refresh failed — clear auth and notify the app
			clearStoredToken();
			clearStoredRefreshToken();
			_onAuthFailed?.();
			throw err;
		})
		.finally(() => {
			refreshPromise = null;
		});

	return refreshPromise;
}

// ── Session status (cookie-aware) ─────────────────────────────────
//
// With httpOnly cookie auth, the JWT is not accessible to JavaScript, so
// we cannot inspect its expiry client-side. The status below reflects
// only what the auth store knows: authenticated or not. The backend
// enforces real expiry; a 401 on the next request triggers refresh or
// logout transparently.

/** Auth status for UI indicators. */
export function tokenStatus(): "valid" | "expired" | "none" {
	const isAuthenticated = useAuthStore.getState().isAuthenticated;
	if (!isAuthenticated) return "none";
	return "valid";
}

let refreshInterval: ReturnType<typeof setInterval> | null = null;

/** Verify the session is still valid; refresh on failure. */
function verifySession() {
	if (!useAuthStore.getState().isAuthenticated) return;
	// Try to hit /auth/me to verify the cookie is still valid
	_fetchJson("/auth/me", { noAuth: true }).catch(() => {
		// Session expired — try refresh
		refreshAccessToken().catch(() => {});
	});
}

let visibilityBound = false;

/** Start periodic token refresh. With cookies, the backend handles rotation
 *  transparently — we just need to verify the session is still valid. */
export function startTokenRefresh() {
	if (refreshInterval) return;
	refreshInterval = setInterval(verifySession, 15 * 60 * 1000);

	// Also re-verify when the tab regains focus — the session may have
	// expired or been revoked (e.g. from another tab) while hidden.
	if (!visibilityBound) {
		visibilityBound = true;
		const refreshNow = () => {
			if (document.visibilityState === "visible") verifySession();
		};
		document.addEventListener("visibilitychange", refreshNow);
		window.addEventListener("focus", refreshNow);
	}
}

export function stopTokenRefresh() {
	if (refreshInterval) {
		clearInterval(refreshInterval);
		refreshInterval = null;
	}
}

// ── Auth API ───────────────────────────────────────────────────────

export const authApi = {
	status: () =>
		apiRequest<{ has_users: boolean }>("/auth/status", {
			noAuth: true,
			schema: authStatusSchema,
		}),

	register: (data: {
		username: string;
		password: string;
		display_name?: string;
	}) =>
		apiRequest<RegisterResponse>("/auth/register", {
			method: "POST",
			body: data,
			noAuth: true,
			schema: registerResponseSchema,
		}),

	login: (data: { username: string; password: string }) =>
		apiRequest<AuthResponse>("/auth/login", {
			method: "POST",
			body: data,
			schema: authResponseSchema,
		}),

	me: () =>
		apiRequest<AuthResponse>("/auth/me", { schema: authResponseSchema }),

	changePassword: (data: { old_password: string; new_password: string }) =>
		apiRequest<{ status: string }>("/auth/change-password", {
			method: "POST",
			body: data,
		}),
	logout: () =>
		apiRequest<{ status: string }>("/auth/logout", { method: "POST" }),
	// Admin
	users: () =>
		apiRequest<
			Array<{
				id: number;
				username: string;
				role: string;
				display_name: string;
			}>
		>("/auth/users", { schema: z.array(userSchema) }),

	deleteUser: (username: string) =>
		apiRequest<{ status: string }>(`/auth/users/${username}`, {
			method: "DELETE",
		}),

	registrationRequests: () =>
		apiRequest<RegistrationRequest[]>("/auth/registration-requests", {
			schema: z.array(registrationRequestSchema),
		}),

	approveRegistration: (id: number) =>
		apiRequest<{
			id: number;
			username: string;
			role: string;
			display_name: string;
		}>(`/auth/registration-requests/${id}/approve`, { method: "POST" }),

	denyRegistration: (id: number, reason?: string) =>
		apiRequest<{ status: string }>(
			`/auth/registration-requests/${id}/deny`,
			{ method: "POST", body: { reason: reason ?? "" } },
		),
};

// ── Sessions API ───────────────────────────────────────────────────

export const sessionsApi = {
	list: () => fetchList<Session>("/sessions/", sessionSchema),
	get: (id: number) =>
		apiRequest<Session>(`/sessions/${id}`, { schema: sessionSchema }),
	create: (data: {
		profile_id?: number;
		engine_id: number;
		resolver_id: number;
		resolver_config?: Record<string, unknown>;
		retry_mode?: string;
		retry_config?: Record<string, unknown>;
		recording?: boolean;
	}) =>
		apiRequest<Session>("/sessions/", {
			method: "POST",
			body: data,
			schema: sessionSchema,
		}),
	delete: (id: number) =>
		apiRequest<DeleteResult>(`/sessions/${id}`, {
			method: "DELETE",
			schema: deleteResultSchema,
		}),
	stop: (id: number) =>
		apiRequest<ControlResponse>(`/sessions/${id}/stop`, {
			method: "POST",
			schema: controlResponseSchema,
		}),
	enableRecording: (id: number) =>
		apiRequest<ControlResponse>(`/sessions/${id}/recording/enable`, {
			method: "POST",
			schema: controlResponseSchema,
		}),
	disableRecording: (id: number) =>
		apiRequest<ControlResponse>(`/sessions/${id}/recording/disable`, {
			method: "POST",
			schema: controlResponseSchema,
		}),
	saveAsProfile: (sessionId: number, name: string) =>
		apiRequest<Profile>(`/sessions/${sessionId}/save-as-profile`, {
			method: "POST",
			body: { name },
			schema: profileSchema,
		}),
	logs: (
		id: number,
		opts: { stream?: "stdout" | "stderr"; name?: string; offset?: number; limit?: number } = {},
	) =>
		apiRequest<SessionLogs>(`/sessions/${id}/logs`, {
			params: {
				...(opts.stream ? { stream: opts.stream } : {}),
				...(opts.name ? { name: opts.name } : {}),
				...(opts.offset ? { offset: String(opts.offset) } : {}),
				...(opts.limit ? { limit: String(opts.limit) } : {}),
			},
			schema: sessionLogsSchema,
		}),
	recordingProgress: (id: number) =>
		apiRequest<RecordingProgressResponse>(`/sessions/${id}/recording/progress`, {
			schema: recordingProgressResponseSchema,
		}),
};

// ── Autoruns API ───────────────────────────────────────────────────

export const autorunsApi = {
	list: () => fetchList<Autorun>("/autoruns/", autorunSchema),
	get: (id: number) =>
		apiRequest<Autorun>(`/autoruns/${id}`, { schema: autorunSchema }),
	create: (data: {
		user_friendly_name: string;
		snake_case_name: string;
		profile_id?: number;
		engine_id: number;
		resolver_id: number;
		resolver_config?: Record<string, unknown>;
		retry_mode?: string;
		retry_config?: Record<string, unknown>;
		start_time: string;
		end_time: string;
		recording?: boolean;
	}) =>
		apiRequest<Autorun>("/autoruns/", {
			method: "POST",
			body: data,
			schema: autorunSchema,
		}),
	update: (id: number, data: UpdateAutorunPayload) => {
		const parsed = updateAutorunSchema.parse(data);
		return apiRequest<Autorun>(`/autoruns/${id}`, {
			method: "PUT",
			body: parsed,
			schema: autorunSchema,
		});
	},
	delete: (id: number) =>
		apiRequest<DeleteResult>(`/autoruns/${id}`, { method: "DELETE", schema: deleteResultSchema }),
	saveAsProfile: (autorunId: number, name: string) =>
		apiRequest<Profile>(`/autoruns/${autorunId}/save-as-profile`, {
			method: "POST",
			body: { name },
			schema: profileSchema,
		}),
};

// ── Recordings API ─────────────────────────────────────────────────

export const recordingsApi = {
	list: () => fetchList<Recording>("/recordings/", recordingSchema),
	get: (id: number) =>
		apiRequest<Recording>(`/recordings/${id}`, { schema: recordingSchema }),
	delete: (id: number) =>
		apiRequest<DeleteResult>(`/recordings/${id}`, { method: "DELETE", schema: deleteResultSchema }),
};

// ── Profiles API ───────────────────────────────────────────────────

export const profilesApi = {
	list: () => fetchList<Profile>("/profiles/", profileSchema),
	get: (id: number) =>
		apiRequest<Profile>(`/profiles/${id}`, { schema: profileSchema }),
	create: (data: {
		name: string;
		default_engine_id: number;
		resolver_id: number;
		resolver_config?: Record<string, unknown>;
		retry_mode?: string;
		retry_config?: Record<string, unknown>;
	}) =>
		apiRequest<Profile>("/profiles/", {
			method: "POST",
			body: data,
			schema: profileSchema,
		}),
	update: (
		id: number,
		data: Partial<{
			name: string;
			default_engine_id: number;
			resolver_id: number;
			resolver_config: Record<string, unknown>;
			retry_mode: string;
			retry_config: Record<string, unknown>;
		}>,
	) =>
		apiRequest<Profile>(`/profiles/${id}`, {
			method: "PUT",
			body: data,
			schema: profileSchema,
		}),
	delete: (id: number) =>
		apiRequest<DeleteResult>(`/profiles/${id}`, { method: "DELETE", schema: deleteResultSchema }),
};

// ── Plugins API ────────────────────────────────────────────────────

export const pluginsApi = {
	engines: () => fetchList<Engine>("/engines/", engineSchema),
	engine: (id: number) =>
		apiRequest<Engine>(`/engines/${id}`, { schema: engineSchema }),
	resolvers: () => fetchList<Resolver>("/resolvers/", resolverSchema),
	resolver: (id: number) =>
		apiRequest<Resolver>(`/resolvers/${id}`, { schema: resolverSchema }),
};

// ── Import/Export API ─────────────────────────────────────────────

export const importExportApi = {
	validate: (bundle: Record<string, unknown>) =>
		apiRequest<ValidationReport>("/import-export/validate", {
			method: "POST",
			body: bundle,
			schema: validationReportSchema,
		}),
	apply: (
		bundle: Record<string, unknown>,
		pluginMap: Record<string, { type: string; id: number }>,
		removedProfiles: string[] = [],
		removedAutoruns: string[] = [],
	) =>
		apiRequest<ApplyResponse>("/import-export/apply", {
			method: "POST",
			body: {
				bundle,
				plugin_map: pluginMap,
				removed_profiles: removedProfiles,
				removed_autoruns: removedAutoruns,
			},
			schema: applyResponseSchema,
		}),
	exportProfile: (id: number) =>
		apiRequest<ImportBundle>(`/import-export/profiles/${id}/export`, {
			schema: importBundleSchema,
		}),
	exportAutorun: (id: number) =>
		apiRequest<ImportBundle>(`/import-export/autoruns/${id}/export`, {
			schema: importBundleSchema,
		}),
};

// ── Notifications API ──────────────────────────────────────────────

export const notificationsApi = {
	list: () =>
		apiRequest<Notification[]>("/notifications/", {
			schema: z.array(notificationSchema),
		}),
	markRead: (id: number) =>
		apiRequest<Notification>(`/notifications/${id}/read`, {
			method: "POST",
			schema: notificationSchema,
		}),
	markAllRead: () =>
		apiRequest<{ status: string }>("/notifications/read-all", {
			method: "POST",
		}),
};

// ── WebSocket URLs ─────────────────────────────────────────────────

function buildWsUrl(path: string): string {
	return buildServerWsUrl(path);
}

export const getWsEventsUrl = () => buildWsUrl("/ws/events");
export const getWsNotificationsUrl = () => buildWsUrl("/ws/notifications");
