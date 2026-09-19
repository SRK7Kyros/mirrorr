import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  base: process.env.MIRRORR_BASE ?? "/",
  plugins: [react(), tailwindcss()],
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
