import path from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Scaffold spine per architecture brief: dev on 5175 (the Playwright-managed
// port — 5173/5174 belong to other apps and must never be used here), proxy
// /api, /ws and /health to the FastAPI core on :8000, and multi-page inputs
// (desktop index.html + Capacitor mobile.html). Lazy route code-splitting
// comes from per-route `lazy()` imports in src/routes/, not a Vite plugin.
export default defineConfig({
  base: process.env.MIRRORR_BASE ?? "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(import.meta.dirname, "index.html"),
        mobile: path.resolve(import.meta.dirname, "mobile.html"),
      },
    },
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
