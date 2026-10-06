/**
 * Sole read site for `VITE_API_URL` (architecture brief: `config/env.ts`).
 * Default is the same-origin `/api` prefix so dev (Vite proxy → :8000) and
 * any same-origin deploy avoid CORS; set an absolute origin only when the
 * API is cross-origin. The strict boot guard (throw naming the variable
 * before any request) lands with the multi-server wave.
 */
export function getApiUrl(): string {
  const raw: unknown = import.meta.env.VITE_API_URL
  return typeof raw === "string" && raw.length > 0 ? raw : "/api"
}
