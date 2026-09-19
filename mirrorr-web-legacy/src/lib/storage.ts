/**
 * Generic localStorage helpers.
 * Replaces the repetitive getter/setter/clearer pattern for each key.
 *
 * NOTE: JWT tokens are now stored in httpOnly cookies by the backend.
 * localStorage is only used for non-sensitive data (API keys, user info).
 */

function createStorage(key: string) {
	return {
		get: (): string | null => localStorage.getItem(key),
		set: (v: string): void => localStorage.setItem(key, v),
		clear: (): void => localStorage.removeItem(key),
	};
}

const apiKeyStorage = createStorage("mirrorr_api_key");

// JWT tokens are now in httpOnly cookies — these are kept for backward
// compatibility but will be empty for new cookie-based auth.
const tokenStorage = createStorage("mirrorr_jwt");
const refreshStorage = createStorage("mirrorr_refresh_jwt");

export const getStoredToken = tokenStorage.get;
export const setStoredToken = tokenStorage.set;
export const clearStoredToken = tokenStorage.clear;

export const getStoredRefreshToken = refreshStorage.get;
export const setStoredRefreshToken = refreshStorage.set;
export const clearStoredRefreshToken = refreshStorage.clear;

export const getStoredApiKey = apiKeyStorage.get;
export const setStoredApiKey = apiKeyStorage.set;
