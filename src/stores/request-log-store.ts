import { create } from "zustand";

export interface RequestLogEntry {
    id: number;
    timestamp: number;
    method: string;
    url: string;
    path: string;
    status: number | null;
    statusText: string;
    duration: number | null;
    ok: boolean | null;
    error: string | null;
    requestBody: string | null;
    responseBody: string | null;
}

interface RequestLogState {
    entries: RequestLogEntry[];
    nextId: number;
    backendStatus: "connected" | "disconnected" | "checking";
    lastSuccessAt: number | null;
    lastErrorAt: number | null;

    addEntry: (entry: Omit<RequestLogEntry, "id">) => number;
    updateEntry: (id: number, patch: Partial<RequestLogEntry>) => void;
    setBackendStatus: (
        status: "connected" | "disconnected" | "checking",
    ) => void;
    clear: () => void;
}

const MAX_ENTRIES = 200;

export const useRequestLogStore = create<RequestLogState>()((set, get) => ({
    entries: [],
    nextId: 1,
    backendStatus: "checking",
    lastSuccessAt: null,
    lastErrorAt: null,

    addEntry: (entry) => {
        const id = get().nextId;
        set((s) => ({
            entries: [{ ...entry, id }, ...s.entries].slice(0, MAX_ENTRIES),
            nextId: id + 1,
        }));
        return id;
    },

    updateEntry: (id, patch) => {
        set((s) => ({
            entries: s.entries.map((e) =>
                e.id === id ? { ...e, ...patch } : e,
            ),
        }));
    },

    setBackendStatus: (status) => {
        set({
            backendStatus: status,
            lastSuccessAt:
                status === "connected" ? Date.now() : get().lastSuccessAt,
            lastErrorAt:
                status === "disconnected" ? Date.now() : get().lastErrorAt,
        });
    },

    clear: () => set({ entries: [], nextId: 1 }),
}));
