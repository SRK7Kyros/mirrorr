import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
	clearStoredRefreshToken,
	clearStoredToken,
	onAuthFailed,
	stopTokenRefresh,
} from "@/lib/api";
import type { User } from "@/lib/schemas";

interface AuthState {
	/** Legacy field — kept for backward compat. Actual JWT is in httpOnly cookie. */
	token: string | null;
	user: User | null;
	isAuthenticated: boolean;
	setAuth: (token: string, user: User) => void;
	logout: () => void;
	updateUser: (user: Partial<User>) => void;
}

export const useAuthStore = create<AuthState>()(
	persist(
		(set) => ({
			token: null,
			user: null,
			isAuthenticated: false,
			setAuth: (_token, user) =>
				set({
					// Token is now in httpOnly cookie — store "cookie" as placeholder
					token: "cookie",
					user,
					isAuthenticated: true,
				}),
			logout: () => {
				// Clear any legacy localStorage tokens
				clearStoredToken();
				clearStoredRefreshToken();
				stopTokenRefresh();
				// Clear httpOnly cookie by calling the backend logout endpoint
				const API_BASE =
					import.meta.env.VITE_API_URL ?? "http://localhost:8000";
				fetch(`${API_BASE}/auth/logout`, {
					method: "POST",
					credentials: "include",
				}).catch(() => {}); // Best-effort — don't block logout
				set({ token: null, user: null, isAuthenticated: false });
			},
			updateUser: (partial) =>
				set((state) => ({
					user: state.user ? { ...state.user, ...partial } : null,
				})),
		}),
		{
			name: "mirrorr-auth",
			partialize: (state) => ({
				// Don't persist token — it's in httpOnly cookies
				user: state.user,
				isAuthenticated: state.isAuthenticated,
			}),
		},
	),
);

// Register the logout callback so api.ts can trigger logout on refresh failure
// without a circular import (api.ts → auth-store → api.ts)
onAuthFailed(() => useAuthStore.getState().logout());
