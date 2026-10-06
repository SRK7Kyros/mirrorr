/**
 * API-layer hooks — TanStack Query wrappers over `@/api/endpoints` plus the
 * external-store subscriptions for auth and realtime state. These are the only
 * hooks the UI should import for server data; anything purely visual (tick
 * clocks, breakpoint matching, highlight scroll) lives in `@/ui/hooks`.
 */
export * from "./use-entity-list"
export * from "./use-lookups"
export * from "./use-auth-state"
export * from "./use-auth-status"
export * from "./use-notifications"
export * from "./use-realtime-state"
