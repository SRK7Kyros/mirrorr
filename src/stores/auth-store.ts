import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User } from "@/lib/schemas";
import {
    clearStoredToken,
    clearStoredRefreshToken,
    stopTokenRefresh,
    onAuthFailed,
} from "@/lib/api";

interface AuthState {
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
            setAuth: (token, user) =>
                set({ token, user, isAuthenticated: true }),
            logout: () => {
                clearStoredToken();
                clearStoredRefreshToken();
                stopTokenRefresh();
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
                token: state.token,
                user: state.user,
                isAuthenticated: state.isAuthenticated,
            }),
        },
    ),
);

// Register the logout callback so api.ts can trigger logout on refresh failure
// without a circular import (api.ts → auth-store → api.ts)
onAuthFailed(() => useAuthStore.getState().logout());
