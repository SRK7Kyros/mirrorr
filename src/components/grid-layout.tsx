/**
 * Type-safe CSS Grid abstraction.
 *
 * Usage:
 *   const layout = Grid.define({
 *     columns: [{ size: 300, resizable: { min: 180, max: "50%" } }, "1fr"],
 *     rows: ["1fr"],
 *     areas: {
 *       Sidebar: { col: 1, row: 1, rowSpan: 2 },
 *       Header:  { col: 2, row: 1 },
 *       Content: { col: 2, row: 2 },
 *     },
 *     gap: 8,
 *   })
 *
 *   <GridLayout def={layout}>
 *     <GridCell area={layout.Sidebar}><Sidebar /></GridCell>
 *     <GridCell area={layout.Header}><Header /></GridCell>
 *     <GridCell area={layout.Content}><Content /></GridCell>
 *   </GridLayout>
 */
import { useState, useRef, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";

// ── Public types ───────────────────────────────────────────────

export type TrackInput =
    | string
    | {
          size: string | number;
          resizable?: { min: number; max?: string | number };
          name?: string;
      };

export interface GridArea {
    readonly name: string;
    readonly col: number;
    readonly row: number;
    readonly colSpan: number;
    readonly rowSpan: number;
}

export interface ResolvedTrack {
    readonly size: string;
    readonly resizable: { min: number; max: string } | null;
    readonly index: number;
}

export interface GridDefinition {
    readonly columns: readonly ResolvedTrack[];
    readonly rows: readonly ResolvedTrack[];
    readonly gap: number | string;
}

// ── Helpers ────────────────────────────────────────────────────

function resolveMax(
    max: string | number | undefined,
    containerSize: number,
): number {
    if (max === undefined) return Infinity;
    if (typeof max === "number") return max;
    if (max.endsWith("%")) return (parseFloat(max) / 100) * containerSize;
    if (max.endsWith("px")) return parseFloat(max);
    return Infinity;
}

function toPx(size: string | number): string {
    return typeof size === "number" ? `${size}px` : size;
}

function resolveTracks(tracks: TrackInput[]): ResolvedTrack[] {
    return tracks.map((t, i) => {
        if (typeof t === "string")
            return { size: t, resizable: null, index: i };
        const size = toPx(t.size);
        const resizable = t.resizable
            ? { min: t.resizable.min, max: toPx(t.resizable.max ?? "100%") }
            : null;
        return { size, resizable, index: i };
    });
}

function defaultSizePx(size: string, fallback: number): number {
    if (size.endsWith("px")) return parseFloat(size);
    return fallback;
}

// ── Grid.define() ──────────────────────────────────────────────

const BUILTIN = new Set(["columns", "rows", "gap"]);

function defineGrid(config: {
    columns: TrackInput[];
    rows: TrackInput[];
    gap?: number | string;
}): GridDefinition;
function defineGrid<
    const A extends Record<
        string,
        { col: number; row: number; colSpan?: number; rowSpan?: number }
    >,
>(config: {
    columns: TrackInput[];
    rows: TrackInput[];
    areas: A;
    gap?: number | string;
}): GridDefinition & { readonly [K in keyof A]: GridArea };
function defineGrid(config: any): any {
    const { columns, rows, areas = {}, gap = 8 } = config;
    const nCols = columns.length;
    const nRows = rows.length;

    // ── Validate areas ─────────────────────────────────────
    for (const name of Object.keys(areas)) {
        if (BUILTIN.has(name))
            throw new Error(
                `Grid.define: area "${name}" conflicts with built-in property`,
            );
        const a = areas[name];
        if (a.col < 1 || a.col > nCols)
            throw new Error(
                `Grid.define: ${name}.col=${a.col} out of range [1..${nCols}]`,
            );
        if (a.row < 1 || a.row > nRows)
            throw new Error(
                `Grid.define: ${name}.row=${a.row} out of range [1..${nRows}]`,
            );
        if (a.col + (a.colSpan ?? 1) - 1 > nCols)
            throw new Error(`Grid.define: ${name} colSpan overflows columns`);
        if (a.row + (a.rowSpan ?? 1) - 1 > nRows)
            throw new Error(`Grid.define: ${name} rowSpan overflows rows`);
    }

    // ── Overlap check ──────────────────────────────────────
    const grid: (string | null)[][] = Array.from({ length: nRows }, () =>
        Array(nCols).fill(null),
    );
    for (const [name, a] of Object.entries(areas) as [string, any][]) {
        for (let r = a.row - 1; r < a.row - 1 + (a.rowSpan ?? 1); r++) {
            for (let c = a.col - 1; c < a.col - 1 + (a.colSpan ?? 1); c++) {
                if (grid[r]![c]!)
                    throw new Error(
                        `Grid.define: ${name} overlaps ${grid[r]![c]} at [${r + 1},${c + 1}]`,
                    );
                grid[r]![c] = name;
            }
        }
    }

    // ── Build area objects ─────────────────────────────────
    const areaObjs: Record<string, GridArea> = {};
    for (const [name, a] of Object.entries(areas) as [string, any][]) {
        areaObjs[name] = Object.freeze({
            name,
            col: a.col,
            row: a.row,
            colSpan: a.colSpan ?? 1,
            rowSpan: a.rowSpan ?? 1,
        });
    }

    return Object.freeze({
        columns: Object.freeze(resolveTracks(columns)),
        rows: Object.freeze(resolveTracks(rows)),
        gap,
        ...areaObjs,
    });
}

export const Grid = { define: defineGrid };

// ── Internal: drag handle ──────────────────────────────────────

function GridHandle({
    axis,
    position,
    onDelta,
}: {
    axis: "vertical" | "horizontal";
    position: number;
    onDelta: (delta: number) => void;
}) {
    return (
        <div
            className="absolute z-10 group/handle"
            style={
                axis === "vertical"
                    ? {
                          left: position - 5,
                          top: 0,
                          bottom: 0,
                          width: 10,
                          cursor: "ew-resize",
                      }
                    : {
                          top: position - 5,
                          left: 0,
                          right: 0,
                          height: 10,
                          cursor: "ns-resize",
                      }
            }
            onMouseDown={(e) => {
                e.preventDefault();
                const startPos = axis === "vertical" ? e.clientX : e.clientY;
                let lastPos = startPos;

                const onMove = (ev: MouseEvent) => {
                    const currentPos =
                        axis === "vertical" ? ev.clientX : ev.clientY;
                    const delta = currentPos - lastPos;
                    if (delta !== 0) {
                        onDelta(delta);
                        lastPos = currentPos;
                    }
                };

                const onUp = () => {
                    document.removeEventListener("mousemove", onMove);
                    document.removeEventListener("mouseup", onUp);
                    document.body.style.cursor = "";
                    document.body.style.userSelect = "";
                };

                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
                document.body.style.cursor =
                    axis === "vertical" ? "ew-resize" : "ns-resize";
                document.body.style.userSelect = "none";
            }}
        >
            <div
                className={cn(
                    "absolute rounded-full bg-border/50 transition-colors group-hover/handle:bg-primary/50",
                    axis === "vertical"
                        ? "left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 w-[3px] h-8"
                        : "top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 h-[3px] w-8",
                )}
            />
        </div>
    );
}

// ── GridLayout ─────────────────────────────────────────────────

export interface GridLayoutProps {
    def?: GridDefinition;
    columns?: TrackInput[];
    rows?: TrackInput[];
    gap?: number | string;
    autoFlow?: string;
    autoRows?: string;
    className?: string;
    children: React.ReactNode;
}

export function GridLayout({
    def,
    columns: rawCols,
    rows: rawRows,
    gap: rawGap,
    autoFlow,
    autoRows,
    className,
    children,
}: GridLayoutProps) {
    // Stable key from serialized input — avoids infinite loops from inline array references
    const rawColsKey = useMemo(() => JSON.stringify(rawCols), [rawCols]);
    const rawRowsKey = useMemo(() => JSON.stringify(rawRows), [rawRows]);
    const defColsKey = def?.columns ? JSON.stringify(def.columns) : undefined;
    const defRowsKey = def?.rows ? JSON.stringify(def.rows) : undefined;

    const columns = useMemo(
        () => def?.columns ?? resolveTracks(rawCols ?? ["1fr"]),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [defColsKey, rawColsKey],
    );
    const rows = useMemo(
        () => def?.rows ?? resolveTracks(rawRows ?? ["1fr"]),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [defRowsKey, rawRowsKey],
    );
    const gap = def?.gap ?? rawGap ?? 8;
    const gapStr = typeof gap === "number" ? `${gap}px` : gap;
    const gapPx = typeof gap === "number" ? gap : parseFloat(gap) || 0;

    // ── Resizable track state ──────────────────────────────
    const [colSizes, setColSizes] = useState<Record<number, number>>(() => {
        const init: Record<number, number> = {};
        for (const c of columns)
            if (c.resizable) init[c.index] = defaultSizePx(c.size, 300);
        return init;
    });

    const [rowSizes, setRowSizes] = useState<Record<number, number>>(() => {
        const init: Record<number, number> = {};
        for (const r of rows)
            if (r.resizable) init[r.index] = defaultSizePx(r.size, 200);
        return init;
    });

    // ── Measure non-resizable tracks ───────────────────────
    const containerRef = useRef<HTMLDivElement>(null);
    const [measuredCols, setMeasuredCols] = useState<Record<number, number>>(
        {},
    );
    const [measuredRows, setMeasuredRows] = useState<Record<number, number>>(
        {},
    );

    const gridTemplateColumns = columns
        .map((c) => (c.resizable ? `${colSizes[c.index] ?? 300}px` : c.size))
        .join(" ");
    const gridTemplateRows = rows
        .map((r) => (r.resizable ? `${rowSizes[r.index] ?? 200}px` : r.size))
        .join(" ");

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const measure = () => {
            const cs = getComputedStyle(el);
            const colPixels = cs.gridTemplateColumns
                .split(" ")
                .map((s) => parseFloat(s));
            const rowPixels = cs.gridTemplateRows
                .split(" ")
                .map((s) => parseFloat(s));

            const newCols: Record<number, number> = {};
            const newRows: Record<number, number> = {};
            for (const c of columns)
                if (!c.resizable) newCols[c.index] = colPixels[c.index] ?? 0;
            for (const r of rows)
                if (!r.resizable) newRows[r.index] = rowPixels[r.index] ?? 0;

            setMeasuredCols(newCols);
            setMeasuredRows(newRows);
        };

        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [columns, rows]);

    // ── Track width helpers ────────────────────────────────
    const colW = (t: ResolvedTrack) =>
        t.resizable ? (colSizes[t.index] ?? 300) : (measuredCols[t.index] ?? 0);
    const rowH = (t: ResolvedTrack) =>
        t.resizable ? (rowSizes[t.index] ?? 200) : (measuredRows[t.index] ?? 0);

    // ── Column handles ─────────────────────────────────────
    const colHandles: { pos: number; onDelta: (d: number) => void }[] = [];
    for (let i = 0; i < columns.length - 1; i++) {
        const left = columns[i]!;
        const right = columns[i + 1]!;
        if (!left.resizable && !right.resizable) continue;

        let pos = 0;
        for (let j = 0; j <= i; j++) pos += colW(columns[j]!);
        pos += (i + 0.5) * gapPx;

        colHandles.push({
            pos,
            onDelta: (delta: number) => {
                const cw = containerRef.current?.offsetWidth ?? 1000;
                setColSizes((prev) => {
                    const next = { ...prev };
                    if (left.resizable && right.resizable) {
                        let l = (prev[left.index] ?? 300) + delta;
                        let r = (prev[right.index] ?? 300) - delta;
                        const lMax = resolveMax(left.resizable.max, cw);
                        const rMax = resolveMax(right.resizable.max, cw);
                        if (l < left.resizable.min) {
                            r -= left.resizable.min - l;
                            l = left.resizable.min;
                        }
                        if (l > lMax) {
                            r += l - lMax;
                            l = lMax;
                        }
                        if (r < right.resizable.min) {
                            l -= right.resizable.min - r;
                            r = right.resizable.min;
                        }
                        if (r > rMax) {
                            l += r - rMax;
                            r = rMax;
                        }
                        next[left.index] = Math.round(l);
                        next[right.index] = Math.round(r);
                    } else if (left.resizable) {
                        const old = prev[left.index] ?? 300;
                        next[left.index] = Math.round(
                            Math.max(
                                left.resizable.min,
                                Math.min(
                                    resolveMax(left.resizable.max, cw),
                                    old + delta,
                                ),
                            ),
                        );
                    } else if (right.resizable) {
                        const old = prev[right.index] ?? 300;
                        next[right.index] = Math.round(
                            Math.max(
                                right.resizable.min,
                                Math.min(
                                    resolveMax(right.resizable.max, cw),
                                    old - delta,
                                ),
                            ),
                        );
                    }
                    return next;
                });
            },
        });
    }

    // ── Row handles ────────────────────────────────────────
    const rowHandles: { pos: number; onDelta: (d: number) => void }[] = [];
    for (let i = 0; i < rows.length - 1; i++) {
        const top = rows[i]!;
        const bottom = rows[i + 1]!;
        if (!top.resizable && !bottom.resizable) continue;

        let pos = 0;
        for (let j = 0; j <= i; j++) pos += rowH(rows[j]!);
        pos += (i + 0.5) * gapPx;

        rowHandles.push({
            pos,
            onDelta: (delta: number) => {
                const ch = containerRef.current?.offsetHeight ?? 800;
                setRowSizes((prev) => {
                    const next = { ...prev };
                    if (top.resizable && bottom.resizable) {
                        let t = (prev[top.index] ?? 200) + delta;
                        let b = (prev[bottom.index] ?? 200) - delta;
                        const tMax = resolveMax(top.resizable.max, ch);
                        const bMax = resolveMax(bottom.resizable.max, ch);
                        if (t < top.resizable.min) {
                            b -= top.resizable.min - t;
                            t = top.resizable.min;
                        }
                        if (t > tMax) {
                            b += t - tMax;
                            t = tMax;
                        }
                        if (b < bottom.resizable.min) {
                            t -= bottom.resizable.min - b;
                            b = bottom.resizable.min;
                        }
                        if (b > bMax) {
                            t += b - bMax;
                            b = bMax;
                        }
                        next[top.index] = Math.round(t);
                        next[bottom.index] = Math.round(b);
                    } else if (top.resizable) {
                        const old = prev[top.index] ?? 200;
                        next[top.index] = Math.round(
                            Math.max(
                                top.resizable.min,
                                Math.min(
                                    resolveMax(top.resizable.max, ch),
                                    old + delta,
                                ),
                            ),
                        );
                    } else if (bottom.resizable) {
                        const old = prev[bottom.index] ?? 200;
                        next[bottom.index] = Math.round(
                            Math.max(
                                bottom.resizable.min,
                                Math.min(
                                    resolveMax(bottom.resizable.max, ch),
                                    old - delta,
                                ),
                            ),
                        );
                    }
                    return next;
                });
            },
        });
    }

    return (
        <div
            ref={containerRef}
            className={cn("relative w-full h-full grid", className)}
            style={{
                gridTemplateColumns,
                gridTemplateRows,
                gap: gapStr,
                gridAutoFlow: autoFlow,
                gridAutoRows: autoRows,
            }}
        >
            {children}
            {colHandles.map((h, i) => (
                <GridHandle
                    key={`col-h-${i}`}
                    axis="vertical"
                    position={h.pos}
                    onDelta={h.onDelta}
                />
            ))}
            {rowHandles.map((h, i) => (
                <GridHandle
                    key={`row-h-${i}`}
                    axis="horizontal"
                    position={h.pos}
                    onDelta={h.onDelta}
                />
            ))}
        </div>
    );
}

// ── GridCell ───────────────────────────────────────────────────

export interface GridCellProps {
    /** Position from a Grid.define() area reference. */
    area?: GridArea;
    /** Manual column start (1-indexed). Ignored when area is set. */
    col?: number;
    /** Manual row start (1-indexed). Ignored when area is set. */
    row?: number;
    colSpan?: number;
    rowSpan?: number;
    /** Inherit parent tracks as subgrid. */
    subgrid?: "rows" | "columns" | "both";
    align?: string;
    justify?: string;
    className?: string;
    children: React.ReactNode;
}

export function GridCell({
    area,
    col,
    row,
    colSpan,
    rowSpan,
    subgrid,
    align,
    justify,
    className,
    children,
}: GridCellProps) {
    const style: React.CSSProperties = {};

    if (area) {
        style.gridColumn = `${area.col} / span ${area.colSpan}`;
        style.gridRow = `${area.row} / span ${area.rowSpan}`;
    } else {
        if (col !== undefined)
            style.gridColumn = colSpan
                ? `${col} / span ${colSpan}`
                : String(col);
        if (row !== undefined)
            style.gridRow = rowSpan ? `${row} / span ${rowSpan}` : String(row);
    }

    if (subgrid) {
        if (subgrid === "both" || subgrid === "columns")
            style.gridTemplateColumns = "subgrid";
        if (subgrid === "both" || subgrid === "rows")
            style.gridTemplateRows = "subgrid";
    }

    if (align) style.alignSelf = align;
    if (justify) style.justifySelf = justify;

    return (
        <div className={className} style={style}>
            {children}
        </div>
    );
}
