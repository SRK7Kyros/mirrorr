import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Scaffold spine per architecture brief: dev on 5175 (the Playwright-managed
// port — 5173/5174 belong to other apps and must never be used here), proxy
// /api, /ws and /health to the FastAPI core on :8000, and multi-page inputs
// (desktop index.html + Capacitor mobile.html). Lazy route code-splitting
// comes from per-route `lazy()` imports in src/routes/, not a Vite plugin.
const surface = process.env.MIRRORR_SURFACE ?? "standard"

// The admin surface is a separate bundle: only the admin build declares
// admin.html, so the standard bundle never contains the admin chunk.
const input: Record<string, string> =
  surface === "admin"
    ? { index: path.resolve(import.meta.dirname, "admin.html") }
    : {
        main: path.resolve(import.meta.dirname, "index.html"),
        mobile: path.resolve(import.meta.dirname, "mobile.html"),
      }

export default defineConfig({
  base: process.env.MIRRORR_BASE ?? "/",
  // Compile-time surface flag: the standard build drops every admin branch
  // during bundling rather than hiding it behind a runtime check.
  define: { __ADMIN__: JSON.stringify(surface === "admin") },
  // `tailwindcss()` scans sources and compiles `src/ui/styles/tailwind.css`
  // (imported first from app.css) — see that file for the zero-delta contract.
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  build: {
    rollupOptions: { input },
  },
  server: {
    host: "127.0.0.1",
    port: 5175,
    strictPort: true,
    proxy: {
      "/api/": {
        target: "http://127.0.0.1:8000/",
        rewrite: (requestPath) => requestPath.replace(/^\/api\//, "/"),
      },
      "/ws/": {
        target: "ws://127.0.0.1:8000",
        ws: true,
      },
      "/health": "http://127.0.0.1:8000",
    },
  },
})
