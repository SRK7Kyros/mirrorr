import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

// ── Types ─────────────────────────────────────────────────────

interface MultiSelectContextValue {
	/** Set of currently selected item IDs */
	selectedIds: Set<number>;
	/** Number of selected items */
	count: number;
	/** Whether any items are selected */
	active: boolean;
	/** Check if an ID is selected */
	isSelected: (id: number) => boolean;
	/** Handle modifier-click (Ctrl/Cmd/Shift) — toggles or range-selects.
	 * Accepts either a mouse or keyboard event since both expose the modifier keys. */
	handleModifierClick: (
		id: number,
		e: React.MouseEvent | React.KeyboardEvent,
	) => void;
	/** Handle plain click — updates anchor only, never touches selection */
	handlePlainClick: (id: number) => void;
	/** Clear all selection */
	clear: () => void;
}

const MultiSelectContext = createContext<MultiSelectContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────

interface MultiSelectProviderProps {
	/** Ordered list of all item IDs (must match render order) */
	allIds: number[];
	children: React.ReactNode;
}

export function MultiSelectProvider({
	allIds,
	children,
}: MultiSelectProviderProps) {
	const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
	// Ref for the anchor — always current, avoids stale closure in handleModifierClick
	const lastFocusedRef = useRef<number | null>(null);

	// Map ID → index for O(1) lookups
	const idToIndex = useMemo(() => {
		const map = new Map<number, number>();
		allIds.forEach((id, i) => {
			map.set(id, i);
		});
		return map;
	}, [allIds]);

	// Escape clears selection
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				setSelectedIds(new Set());
				lastFocusedRef.current = null;
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	const clear = useCallback(() => {
		setSelectedIds(new Set());
		lastFocusedRef.current = null;
	}, []);

	const handlePlainClick = useCallback((id: number) => {
		lastFocusedRef.current = id;
	}, []);

	const handleModifierClick = useCallback(
		(id: number, e: React.MouseEvent | React.KeyboardEvent) => {
			if (e.shiftKey && lastFocusedRef.current !== null) {
				// Range select from anchor to clicked item
				const fromIdx = idToIndex.get(lastFocusedRef.current);
				const toIdx = idToIndex.get(id);
				if (fromIdx != null && toIdx != null) {
					const start = Math.min(fromIdx, toIdx);
					const end = Math.max(fromIdx, toIdx);
					const rangeIds = allIds.slice(start, end + 1);
					setSelectedIds((prev) => {
						const next = new Set(prev);
						for (const rid of rangeIds) next.add(rid);
						return next;
					});
				}
			} else if (e.ctrlKey || e.metaKey) {
				// Toggle single item
				setSelectedIds((prev) => {
					const next = new Set(prev);
					if (next.has(id)) next.delete(id);
					else next.add(id);
					return next;
				});
			}
			lastFocusedRef.current = id;
		},
		[allIds, idToIndex],
	);

	const isSelected = useCallback(
		(id: number) => selectedIds.has(id),
		[selectedIds],
	);

	const value: MultiSelectContextValue = {
		selectedIds,
		count: selectedIds.size,
		active: selectedIds.size > 0,
		isSelected,
		handleModifierClick,
		handlePlainClick,
		clear,
	};

	return (
		<MultiSelectContext.Provider value={value}>
			{children}
		</MultiSelectContext.Provider>
	);
}

// ── Hooks ─────────────────────────────────────────────────────

/** Access multi-select state. Throws if used outside a MultiSelectProvider. */
export function useMultiSelect() {
	const ctx = useContext(MultiSelectContext);
	if (!ctx)
		throw new Error("useMultiSelect must be used within a MultiSelectProvider");
	return ctx;
}

/** Safe version — returns null when outside a provider. */
export function useMultiSelectOrNull() {
	return useContext(MultiSelectContext);
}
