/**
 * Resizable grid columns with localStorage persistence.
 *
 * Define a set of columns with fixed pixel or flexible (fr) defaults. Fixed
 * columns get a drag handle; dragging converts their track to an explicit
 * pixel width. Flexible columns absorb remaining space. Widths persist in
 * localStorage keyed by `storageKey`.
 *
 * Usage:
 *   const { gridTemplateColumns, handleProps } = useResizableColumns({
 *     storageKey: "import-profiles-cols",
 *     columns: [
 *       { id: "check", width: 28, resizable: false },
 *       { id: "status", width: 96 },
 *       { id: "name", flex: 1 },
 *       { id: "engine", width: 110 },
 *     ],
 *   });
 *   <div style={{ gridTemplateColumns }} className="grid">...</div>
 *   // render <ColHandle {...handleProps("status")} /> on the status border
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type ColumnDef = {
	id: string;
	/** Fixed pixel width. */
	width?: number;
	/** Flexible fraction (minmax(0, Nfr)). */
	flex?: number;
	/** Whether the column can be drag-resized. Defaults to true for width cols. */
	resizable?: boolean;
	/** Minimum pixel width when resizing. Default 40. */
	min?: number;
};

type Options = {
	storageKey: string;
	columns: ColumnDef[];
};

const MIN_DEFAULT = 40;

export function useResizableColumns({ storageKey, columns }: Options) {
	// Map of columnId → pixel width override
	const [overrides, setOverrides] = useState<Record<string, number>>(() => {
		try {
			const raw = localStorage.getItem(storageKey);
			return raw ? (JSON.parse(raw) as Record<string, number>) : {};
		} catch {
			return {};
		}
	});

	// Persist overrides
	useEffect(() => {
		try {
			localStorage.setItem(storageKey, JSON.stringify(overrides));
		} catch {
			// storage full / unavailable — ignore
		}
	}, [storageKey, overrides]);

	// Build the grid-template-columns string
	const gridTemplateColumns = columns
		.map((c) => {
			if (c.flex != null && overrides[c.id] == null) {
				return `minmax(0,${c.flex}fr)`;
			}
			const base = overrides[c.id] ?? c.width ?? 80;
			return `${base}px`;
		})
		.join(" ");

	// Active drag state (refs so listeners always see latest)
	const dragState = useRef<{
		colId: string;
		startX: number;
		startWidth: number;
	} | null>(null);

	const onMouseMove = useCallback(
		(e: MouseEvent) => {
			const drag = dragState.current;
			if (!drag) return;
			const col = columns.find((c) => c.id === drag.colId);
			const min = col?.min ?? MIN_DEFAULT;
			const next = Math.max(min, drag.startWidth + (e.clientX - drag.startX));
			setOverrides((prev) => ({ ...prev, [drag.colId]: Math.round(next) }));
		},
		[columns],
	);

	const onMouseUpRef = useRef<() => void>(() => {});
	const onMouseUp = useCallback(() => {
		dragState.current = null;
		document.body.style.cursor = "";
		document.body.style.userSelect = "";
		window.removeEventListener("mousemove", onMouseMove);
		window.removeEventListener("mouseup", onMouseUpRef.current);
	}, [onMouseMove]);

	useEffect(() => {
		onMouseUpRef.current = onMouseUp;
	}, [onMouseUp]);

	// Clean up listeners if the component unmounts mid-drag
	useEffect(() => {
		return () => {
			window.removeEventListener("mousemove", onMouseMove);
			window.removeEventListener("mouseup", onMouseUp);
		};
	}, [onMouseMove, onMouseUp]);

	/**
	 * Returns props to spread onto a drag-handle element for column `id`.
	 * Returns null when the column isn't resizable.
	 */
	const handleProps = useCallback(
		(id: string) => {
			const col = columns.find((c) => c.id === id);
			if (!col) return null;
			const resizable = col.resizable ?? col.width != null;
			if (!resizable) return null;

			return {
				onMouseDown: (e: React.MouseEvent) => {
					e.preventDefault();
					e.stopPropagation();
					// Measure the column's live rendered width from the header cell,
					// falling back to the override/declared width. The handle lives
					// inside the cell, so its parent's bounding box is the track width.
					const cellEl = (e.currentTarget as HTMLElement).parentElement;
					const measured = cellEl?.getBoundingClientRect().width;
					const current =
						measured && measured > 0
							? measured
							: (overrides[id] ?? col.width ?? 80);
					dragState.current = {
						colId: id,
						startX: e.clientX,
						startWidth: current,
					};
					document.body.style.cursor = "col-resize";
					document.body.style.userSelect = "none";
					window.addEventListener("mousemove", onMouseMove);
					window.addEventListener("mouseup", onMouseUpRef.current);
				},
			};
		},
		[columns, overrides, onMouseMove, onMouseUp],
	);

	const resetWidths = useCallback(() => setOverrides({}), []);

	return { gridTemplateColumns, handleProps, resetWidths };
}
