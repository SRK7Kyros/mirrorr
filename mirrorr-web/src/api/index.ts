/**
 * Public surface of the Mirrorr web API layer.
 *
 * The layer is a plain TypeScript module — no React components, no routing, no
 * styling. A UI of any shape can be built on top of it. Sub-modules stay
 * importable directly (`@/api/schemas`, `@/api/query-keys`, …) for the two
 * namespaces that would otherwise collide; everything else is re-exported here
 * for one-path imports.
 *
 * See `README.md` for the full contract.
 */
export * from "./client"
export * from "./config"
export * from "./auth"
export * from "./polling"
export * from "./status"
export * from "./time"
export * from "./entity-store"
export * from "./infinite-lists"
export * from "./query-client"
export * from "./native"
export * from "./endpoints"
export * from "./endpoints/settings"
export * from "./domain/errors"
export * from "./domain/dirty"
export * from "./domain/bundle"
export * from "./domain/filter-grammar"
export * from "./realtime/manager"
export * from "./realtime/event-table"
export * from "./hooks"

// Namespaced to avoid the `CursorPage` / `AuthStatus` name collisions between
// `schemas` and `query-keys` / `auth`.
export * as schemas from "./schemas"
export * as queryKeys from "./query-keys"
