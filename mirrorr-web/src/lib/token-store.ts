import { getActiveInstance, useServerStore } from "@/lib/server";

export interface TokenPair {
	access: string;
	refresh: string;
}

const DEVICE_ID_KEY = "mirrorr.mobile.deviceId";
const TOKEN_KEY_PREFIX = "mirrorr_tokens:";

export function tokenKeyFor(serverId: string): string {
	return `${TOKEN_KEY_PREFIX}${serverId}`;
}

export function isNativeApp(): boolean {
	try {
		if (typeof window === "undefined") return false;
		const cap = (
			window as typeof window & {
				Capacitor?: { isNativePlatform?: () => boolean };
			}
		).Capacitor;
		if (cap?.isNativePlatform?.() === true) return true;
		return window.location.protocol === "capacitor:";
	} catch {
		return false;
	}
}

export function getDeviceId(): string {
	try {
		const existing = window.localStorage.getItem(DEVICE_ID_KEY);
		if (existing && existing.trim()) return existing.trim();
		const generated =
			typeof crypto !== "undefined" && "randomUUID" in crypto
				? crypto.randomUUID()
				: `dev-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
		window.localStorage.setItem(DEVICE_ID_KEY, generated);
		return generated;
	} catch {
		return `dev-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
	}
}

function readWeb(key: string): TokenPair | null {
	try {
		const raw = window.localStorage.getItem(key);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<TokenPair>;
		if (typeof parsed.access !== "string" || !parsed.access) return null;
		return {
			access: parsed.access,
			refresh: typeof parsed.refresh === "string" ? parsed.refresh : "",
		};
	} catch {
		return null;
	}
}

function writeWeb(key: string, pair: TokenPair): void {
	window.localStorage.setItem(key, JSON.stringify(pair));
}

async function withTimeout<T>(op: Promise<T>, fallback: T, ms = 2000): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<T>((resolve) => {
		timer = setTimeout(() => resolve(fallback), ms);
	});
	try {
		return await Promise.race([op.catch(() => fallback), timeout]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

async function readNative(key: string): Promise<TokenPair | null> {
	try {
		const { SecureStorage } = await import(
			"@aparajita/capacitor-secure-storage"
		);
		const raw = await withTimeout(
			SecureStorage.getItem(key),
			null as string | null,
		);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<TokenPair>;
		if (typeof parsed.access !== "string" || !parsed.access) return null;
		return {
			access: parsed.access,
			refresh: typeof parsed.refresh === "string" ? parsed.refresh : "",
		};
	} catch {
		return readWeb(key);
	}
}

async function writeNative(key: string, pair: TokenPair): Promise<void> {
	try {
		const { SecureStorage } = await import(
			"@aparajita/capacitor-secure-storage"
		);
		await withTimeout(
			SecureStorage.setItem(key, JSON.stringify(pair)),
			undefined,
		);
	} catch {
		writeWeb(key, pair);
	}
	try {
		writeWeb(`${key}.meta`, { access: "1", refresh: "" });
	} catch {
		// metadata best-effort
	}
}

async function clearNative(key: string): Promise<void> {
	try {
		const { SecureStorage } = await import(
			"@aparajita/capacitor-secure-storage"
		);
		await withTimeout(SecureStorage.removeItem(key), undefined);
	} catch {
		// fall through to web clear
	}
	try {
		window.localStorage.removeItem(key);
		window.localStorage.removeItem(`${key}.meta`);
	} catch {
		// ignore
	}
}

export function getActiveServerId(): string | null {
	try {
		return useServerStore.getState().activeId;
	} catch {
		return null;
	}
}

export async function getTokens(serverId: string): Promise<TokenPair | null> {
	if (!serverId) return null;
	const key = tokenKeyFor(serverId);
	if (isNativeApp()) return readNative(key);
	try {
		return readWeb(key);
	} catch {
		return null;
	}
}

export async function setTokens(
	serverId: string,
	pair: TokenPair,
): Promise<void> {
	if (!serverId || !pair.access) return;
	const key = tokenKeyFor(serverId);
	if (isNativeApp()) {
		await writeNative(key, pair);
		return;
	}
	try {
		writeWeb(key, pair);
	} catch {
		// storage unavailable
	}
}

export async function clearTokens(serverId: string): Promise<void> {
	if (!serverId) return;
	const key = tokenKeyFor(serverId);
	if (isNativeApp()) {
		await clearNative(key);
		return;
	}
	try {
		window.localStorage.removeItem(key);
	} catch {
		// ignore
	}
}

export async function getActiveTokens(): Promise<TokenPair | null> {
	const id = getActiveServerId();
	if (!id) {
		const active = getActiveInstance();
		if (!active) return null;
		return getTokens(active.id);
	}
	return getTokens(id);
}

export async function setActiveTokens(pair: TokenPair): Promise<void> {
	const id = getActiveServerId();
	if (!id) {
		const active = getActiveInstance();
		if (!active) return;
		await setTokens(active.id, pair);
		return;
	}
	await setTokens(id, pair);
}

export async function clearActiveTokens(): Promise<void> {
	const id = getActiveServerId();
	if (!id) {
		const active = getActiveInstance();
		if (!active) return;
		await clearTokens(active.id);
		return;
	}
	await clearTokens(id);
}

export async function getBearerForActive(): Promise<string | null> {
	const pair = await getActiveTokens();
	if (pair && pair.access) return pair.access;
	return null;
}
