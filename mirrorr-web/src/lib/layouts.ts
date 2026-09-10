/**
 * Centralized layout constants.
 *
 * Every grid definition, named area, and magic value lives here.
 * Components reference these constants instead of defining layouts inline.
 *
 * Naming convention: each constant is a plain object with:
 *   - area:   the CSS gridTemplateAreas string
 *   - columns: the CSS gridTemplateColumns string (may use `${var}px` for dynamic)
 *   - rows?:   the CSS gridTemplateRows string (only for row-based grids)
 *
 * Usage:
 *   <div style={LAYOUTS.appShell.style}>        → gridTemplateAreas + gridTemplateRows
 *   <div style={LAYOUTS.sidebarDetail.style}>   → gridTemplateAreas + gridTemplateColumns
 *   <div style={LAYOUTS.networkRow.style}>      → gridTemplateAreas + gridTemplateColumns
 */

// ── Helper ────────────────────────────────────────────────────────────

function gridStyle(
	area: string,
	columns: string,
	rows?: string,
): React.CSSProperties {
	const style: React.CSSProperties = {
		gridTemplateAreas: area,
		gridTemplateColumns: columns,
	};
	if (rows) style.gridTemplateRows = rows;
	return style;
}

// ── App shell ─────────────────────────────────────────────────────────

/** Full-screen app: top navbar + page content */
export const APP_SHELL = {
	style: gridStyle('"navbar" "content"', "1fr", "auto 1fr"),
	/** Navbar is implicitly the first child */
	/** Content is implicitly the second child */
} as const;

// ── Two-panel layouts ─────────────────────────────────────────────────

/** Sidebar + detail panel (used by ResizableSidebar — dynamic width via columns override) */
export const SIDEBAR_DETAIL = {
	areas: '"sidebar detail"',
	style: (sidebarWidth: number) =>
		gridStyle('"sidebar detail"', `${sidebarWidth}px 1fr`, "1fr"),
} as const;

/** Profile page: fixed sidebar + scrollable content */
export const PROFILE_LAYOUT = {
	style: gridStyle('"sidebar content"', "260px 1fr", "1fr"),
} as const;

/** Dashboard main area: actions + sessions sidebar */
export const DASHBOARD_MAIN = {
	style: gridStyle('"actions sessions"', "1fr 360px", "1fr"),
} as const;

/** Monitoring session detail: header + charts */
export const MONITORING_SESSION = {
	style: gridStyle('"header" "charts"', "1fr", "auto 1fr"),
} as const;

/** Auth layout: header bar + centered content area */
export const AUTH_LAYOUT = {
	style: gridStyle('"header" "content"', "1fr", "auto 1fr"),
} as const;

/** Detail/Create panel: header + scrollable body */
export const DETAIL_PANEL = {
	style: gridStyle('"header" "content"', "1fr", "auto 1fr"),
} as const;

/** Network monitor floating window: header + scrollable body */
export const NETWORK_MONITOR_SHELL = {
	style: gridStyle('"header" "content"', "1fr", "auto 1fr"),
} as const;

// ── Config fields ─────────────────────────────────────────────────────

/** Config selectors row: [engine+retryMode | resolver] */
export const CONFIG_SELECTORS = {
	style: gridStyle('"selects resolver"', "1fr 1fr"),
} as const;

/** Config panels row: [retry-config | resolver-config] */
export const CONFIG_PANELS = {
	style: gridStyle('"retry-config resolver-config"', "1fr 1fr"),
} as const;

// ── Import dialog ─────────────────────────────────────────────────────

/** Plugin cells: [engine | resolver] */
export const PLUGIN_CELLS = {
	style: gridStyle('"engine resolver"', "1fr 1fr"),
} as const;

/** Time range: [start | end] */
export const TIME_RANGE = {
	style: gridStyle('"start end"', "1fr 1fr"),
} as const;

/**
 * Profile expanded body: [hash | engine | resolver | actions] on row 1,
 * retry + configs below. Hash leads the row, Remove button trails it.
 */
export const PROFILE_EXPANDED = {
	style: gridStyle(
		'"hash engine resolver actions" "retry retry retry retry" "configs configs configs configs"',
		"1.3fr 1fr 1fr auto",
	),
} as const;

/**
 * Autorun expanded body: [hash | schedule | actions] on row 1,
 * profile/engine + configs below.
 */
export const AUTORUN_EXPANDED = {
	style: gridStyle(
		'"hash schedule schedule actions" "profile engine engine engine" "configs configs configs configs"',
		"1.3fr 1fr 1fr auto",
	),
} as const;

// ── Network monitor ───────────────────────────────────────────────────

/** Network request row: 6-column table layout */
export const NETWORK_ROW = {
	areas: '"time method status path dur actions"',
	columns: "70px 56px 32px 1fr 48px 40px",
	style: gridStyle(
		'"time method status path dur actions"',
		"70px 56px 32px 1fr 48px 40px",
	),
} as const;

// ── Reusable area names (for gridArea prop) ───────────────────────────

export const AREAS = {
	// App shell
	navbar: "navbar" as const,
	content: "content" as const,

	// Two-panel layouts
	sidebar: "sidebar" as const,
	detail: "detail" as const,

	// Profile
	// sidebar + content reuse the names above

	// Dashboard
	actions: "actions" as const,
	sessions: "sessions" as const,

	// Monitoring
	header: "header" as const,
	charts: "charts" as const,

	// Config fields
	selects: "selects" as const,
	resolver: "resolver" as const,
	"retry-config": "retry-config" as const,
	"resolver-config": "resolver-config" as const,

	// Import dialog
	engine: "engine" as const,
	// resolver reuses the name above
	start: "start" as const,
	end: "end" as const,
	hash: "hash" as const,
	body: "body" as const,
	retry: "retry" as const,
	configs: "configs" as const,
	schedule: "schedule" as const,
	profile: "profile" as const,

	// Network monitor
	time: "time" as const,
	method: "method" as const,
	status: "status" as const,
	path: "path" as const,
	dur: "dur" as const,
	actions_net: "actions" as const, // aliased to avoid collision with dashboard
} as const;
