/**
 * Generic localStorage helpers.
 * Replaces the repetitive getter/setter/clearer pattern for each key.
 */

function createStorage(key: string) {
	return {
		get: (): string | null => localStorage.getItem(key),
		set: (v: string): void => localStorage.setItem(key, v),
		clear: (): void => localStorage.removeItem(key),
	};
}

const tokenStorage = createStorage("mirrorr_jwt");
const refreshStorage = createStorage("mirrorr_refresh_jwt");
const apiKeyStorage = createStorage("mirrorr_api_key");

export const getStoredToken = tokenStorage.get;
export const setStoredToken = tokenStorage.set;
export const clearStoredToken = tokenStorage.clear;

export const getStoredRefreshToken = refreshStorage.get;
export const setStoredRefreshToken = refreshStorage.set;
export const clearStoredRefreshToken = refreshStorage.clear;

export const getStoredApiKey = apiKeyStorage.get;
export const setStoredApiKey = apiKeyStorage.set;
