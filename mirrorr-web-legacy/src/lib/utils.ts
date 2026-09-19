import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

/** Parse a naive UTC datetime string from the backend into a local Date.
 *  Appends "Z" if the string has no timezone info so JS treats it as UTC. */
export function parseUtcDate(value: string | null | undefined): Date | null {
	if (!value) return null;
	// Already has timezone info — let Date handle it
	if (value.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(value))
		return new Date(value);
	// Naive UTC — append Z so JS interprets as UTC then displays in local time
	return new Date(`${value}Z`);
}

/**
 * Convert a local wall-time or any date input into a UTC-naive ISO string
 * (`YYYY-MM-DDTHH:mm:ss`, no tz suffix) for POST/PUT writes.
 * The server strips tz on write and rejects tz-suffixed values (422), so
 * every datetime write must pass through here.
 *
 * - Naive `"2026-09-07T08:00:00"` → treated as LOCAL wall time, shifted to UTC.
 * - Tz-suffixed (`...Z`, `+08:00`) → converted to UTC, suffix stripped.
 * - Date → UTC parts formatted naive.
 *
 * Example: local `2026-09-07T08:00:00` at UTC+8 → `"2026-09-07T00:00:00"`.
 */
export function toUtcNaive(value: string | Date): string {
	const d = value instanceof Date ? value : parseLocalOrZoned(value);
	const pad = (n: number) => String(n).padStart(2, "0");
	return (
		`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
		`T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
	);
}

/** Parse user input: tz-suffixed as zoned, naive as local wall time. */
function parseLocalOrZoned(value: string): Date {
	if (value.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(value))
		return new Date(value);
	// Naive — interpret as local wall time (what DateTimePicker emits)
	return new Date(value.length === 10 ? `${value}T00:00:00` : value);
}

/** Short local tz label for display hints, e.g. "GMT+8". */
export function tzLabel(): string {
	const mins = -new Date().getTimezoneOffset();
	const sign = mins >= 0 ? "+" : "-";
	const abs = Math.abs(mins);
	const h = Math.floor(abs / 60);
	const m = abs % 60;
	return `GMT${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

/** Format a naive UTC datetime string to a locale-aware local-time string,
 *  always suffixed with the local tz hint (server stores naive UTC). */
export function formatLocalDate(
	value: string | null | undefined,
	opts?: Intl.DateTimeFormatOptions,
): string {
	const d = parseUtcDate(value);
	if (!d || Number.isNaN(d.getTime())) return "—";
	return d.toLocaleString(undefined, {
		hour12: false,
		...opts,
		timeZoneName: opts?.timeZoneName ?? "short",
	});
}

export function formatBytes(bytes: number, decimals = 2): string {
	if (bytes === 0) return "0 B";
	const k = 1024;
	const dm = decimals < 0 ? 0 : decimals;
	const sizes = ["B", "KB", "MB", "GB", "TB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${parseFloat((bytes / k ** i).toFixed(dm))} ${sizes[i]}`;
}

export function formatDuration(seconds: number): string {
	seconds = Math.max(0, Math.floor(seconds));
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = seconds % 60;

	// Show decimals only when the value is below the first display threshold (6s)
	const showDecimals = seconds < 6;
	const sFmt = showDecimals ? Math.round(s * 10) / 10 : Math.floor(s);

	if (d > 0) return `${d}d ${h}h ${m}m ${Math.floor(s)}s`;
	if (h > 0) return `${h}h ${m}m ${Math.floor(s)}s`;
	if (m > 0) return `${m}m ${Math.floor(s)}s`;
	return `${sFmt}s`;
}

/** Statuses during which a session must not be deleted (server 409s). */
export const SESSION_DELETE_BLOCKED_STATUSES = ["remuxing", "finalizing"] as const;

/** True when the delete button must render disabled with a tooltip. */
export function isSessionDeleteBlocked(status: string | null | undefined): boolean {
	return (
		status === "remuxing" || status === "finalizing"
	);
}

export function sessionDeleteBlockedReason(): string {
	return "Cannot delete while remuxing — the recording is being finalized";
}

/** Clamp a number between min and max. */
export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

export function getUserInitial(
	user: { display_name?: string; username?: string } | null | undefined,
): string {
	return (user?.display_name || user?.username || "?")[0].toUpperCase();
}

/** Get the color class for a session/autorun status dot. */
export function getStatusDotColor(status: string): string {
	switch (status) {
		case "active":
		case "running":
			return "bg-emerald-500";
		case "recording":
			return "bg-amber-500";
		case "scheduled":
			return "bg-sky-500";
		case "terminated":
		case "terminating":
			return "bg-orange-500";
		case "remuxing":
		case "finalizing":
		case "completed":
			return "bg-blue-500";
		case "deleting":
			return "bg-violet-500";
		case "failed":
			return "bg-red-500";
		default:
			return "bg-muted-foreground/30";
	}
}

/** Download a JavaScript object as a JSON file. */
export function downloadJson(filename: string, data: unknown) {
	const blob = new Blob([JSON.stringify(data, null, 2)], {
		type: "application/json",
	});
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	// Defer revocation to avoid race with browser download start
	setTimeout(() => URL.revokeObjectURL(url), 100);
}

/**
 * Human-readable summary of a delete cascade result, e.g.
 * "Also removed 2 sessions and 1 recording."
 */
export function describeCascade(result: {
	deleted?: Record<string, number>;
} | null): string | null {
	if (!result?.deleted) return null;
	const counts: string[] = [];
	for (const [key, n] of Object.entries(result.deleted)) {
		if (key === "sessions" && n) counts.push(`${n} session${n === 1 ? "" : "s"}`);
		else if (key === "autoruns" && n) counts.push(`${n} autorun${n === 1 ? "" : "s"}`);
		else if (key === "recordings" && n) counts.push(`${n} recording${n === 1 ? "" : "s"}`);
		else if (key === "profiles" && n) counts.push(`${n} profile${n === 1 ? "" : "s"}`);
	}
	if (counts.length === 0) return null;
	return counts.join(", ");
}
