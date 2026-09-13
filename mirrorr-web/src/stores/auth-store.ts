import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
	clearStoredRefreshToken,
	clearStoredToken,
	onAuthFailed,
	stopTokenRefresh,
} from "@/lib/api";
import type { User } from "@/lib/schemas";
import { getApiBase } from "@/lib/server";
import { clearActiveTokens } from "@/lib/token-store";

interface AuthState {
	user: User | null;
	isAuthenticated: boolean;
	setAuth: (user: User) => void;
	logout: () => void;
	updateUser: (user: Partial<User>) => void;
}

export const useAuthStore = create<AuthState>()(
	persist(
		(set) => ({
			user: null,
			isAuthenticated: false,
			setAuth: (user) =>
				set({
					user,
					isAuthenticated: true,
				}),
			logout: () => {
				// Clear ONLY the active server token entry (no cross-server leak)
				clearActiveTokens().catch(() => {});
				// Clear any legacy localStorage tokens
				clearStoredToken();
				clearStoredRefreshToken();
				stopTokenRefresh();
				// Clear httpOnly cookie by calling the backend logout endpoint
				fetch(`${getApiBase()}/auth/logout`, {
					method: "POST",
					credentials: "include",
				}).catch(() => {}); // Best-effort — don't block logout
				set({ user: null, isAuthenticated: false });
			},
			updateUser: (partial) =>
				set((state) => ({
					user: state.user ? { ...state.user, ...partial } : null,
				})),
		}),
		{
			name: "mirrorr-auth",
			partialize: (state) => ({
				// Don't persist tokens — they're in httpOnly cookies
				user: state.user,
				isAuthenticated: state.isAuthenticated,
			}),
		},
	),
);

// Register the logout callback so api.ts can trigger logout on refresh failure
// without a circular import (api.ts → auth-store → api.ts)
onAuthFailed(() => useAuthStore.getState().logout());
