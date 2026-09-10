// Static file server for the Mirrorr web UI (production build).
// Serves the pre-built `dist` output from Vite, with SPA fallback so
// TanStack Router client-side routes (e.g. /sessions) resolve on
// direct load/refresh. Reads from env: PORT (default 5173), ROOT
// (default <script dir>/web).
import { existsSync, statSync } from "node:fs";
import { join, normalize, sep } from "node:path";

const PORT = Number(process.env.PORT ?? 5173);
const ROOT = process.env.ROOT || join(import.meta.dir, "web");

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

function contentType(path) {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return "application/octet-stream";
  return CONTENT_TYPES[path.slice(dot).toLowerCase()] ?? "application/octet-stream";
}

function resolveSafe(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0] || "/");
  const segments = decoded.split("/").filter(Boolean);
  return join(ROOT, ...segments);
}

async function serve(req) {
  const url = new URL(req.url);
  let filePath = normalize(resolveSafe(url.pathname));

  // Path traversal guard: must stay inside ROOT.
  if (!filePath.startsWith(ROOT) && filePath !== ROOT) {
    filePath = ROOT;
  }

  const respondFile = async (path) => {
    if (!existsSync(path)) return null;
    const r = statSync(path);
    if (r.isDirectory()) {
      const idx = join(path, "index.html");
      if (existsSync(idx)) return respondFile(idx);
      return null;
    }
    const file = Bun.file(path);
    return new Response(file, {
      headers: {
        "Content-Type": contentType(path),
        "Cache-Control":
          path.endsWith(".html") || path.endsWith(".svg")
            ? "no-cache"
            : "public, max-age=31536000, immutable",
      },
    });
  };

  // index.html for the root is handled below; try path first.
  if (url.pathname !== "/") {
    const r = await respondFile(filePath);
    if (r) return r;
  }

  // SPA fallback -> index.html
  const fallback = await respondFile(join(ROOT, "index.html"));
  if (fallback) return fallback;

  return new Response("Not found", { status: 404 });
}

const server = Bun.serve({
  port: PORT,
  hostname: process.env.HOST ?? "127.0.0.1",
  fetch: serve,
});

console.log(`mirrorr-web static server listening on http://${server.hostname}:${server.port} (root=${ROOT})`);