import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  base: process.env.MIRRORR_BASE ?? "/",
  plugins: [react(), tailwindcss()],
  // Pre-bundled at server start: the wrapper reaches these through dynamic imports
  // (a browser build must not ship or evaluate plugin code), and a dep Vite only
  // discovers mid-session triggers a full page reload that stalls the import.
  optimizeDeps: {
    include: [
      "@aparajita/capacitor-secure-storage",
      "@capacitor/app",
      "@capacitor/browser",
      "@capacitor/clipboard",
      "@capacitor/core",
      "@capacitor/keyboard",
      "@capacitor/splash-screen",
      "@capacitor/status-bar",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        mobile: path.resolve(__dirname, "mobile.html"),
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
