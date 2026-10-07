/// <reference types="vite/client" />

/**
 * Build-time surface flag (`vite.config.ts` `define`). `true` in the admin
 * bundle, `false` in the standard one — an admin-only branch guarded by it is
 * compiled out of the bundle non-admins are served, never hidden at runtime.
 */
declare const __ADMIN__: boolean
