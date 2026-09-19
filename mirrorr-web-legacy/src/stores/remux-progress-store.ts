import { create } from "zustand";

export interface RemuxProgress {
	percent: number;
	eta_seconds?: number | null;
	speed?: number | null;
	time?: number | null;
	frame?: number | null;
	receivedAt: number;
}

interface RemuxProgressState {
	bySession: Record<number, RemuxProgress>;
	setProgress: (sessionId: number, p: Omit<RemuxProgress, "receivedAt">) => void;
	clearProgress: (sessionId: number) => void;
}

export const useRemuxProgressStore = create<RemuxProgressState>()((set) => ({
	bySession: {},
	setProgress: (sessionId, p) =>
		set((s) => ({
			bySession: { ...s.bySession, [sessionId]: { ...p, receivedAt: Date.now() } },
		})),
	clearProgress: (sessionId) =>
		set((s) => {
			if (!(sessionId in s.bySession)) return s;
			const next = { ...s.bySession };
			delete next[sessionId];
			return { bySession: next };
		}),
}));

export function selectRemuxProgress(
	s: RemuxProgressState,
	sessionId: number,
): RemuxProgress | null {
	return s.bySession[sessionId] ?? null;
}
