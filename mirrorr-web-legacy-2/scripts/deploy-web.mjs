#!/usr/bin/env bun
/**
 * Build mirrorr-web for production and publish the bundle into the live
 * nginx static root (dev/web).
 *
 * Why a script: the deploy used to be a manual `cp -r dist/* dev/web`, with no
 * record of which base path was used. The deployed site must be built with
 * `base: "/"` so index.html references `/assets/…` (nginx serves them from
 * `location /assets/`). The Vite dev unit (5174) instead runs with
 * `MIRRORR_BASE=/dev/` and is unaffected by this script.
 *
 * Publish semantics:
 *  - copy the new bundle over the existing dev/web tree first (index.html is
 *    never absent, so the running server cannot 404 mid-deploy),
 *  - then prune files that are not part of the new bundle (stale hashed chunks),
 *  - the dev/web directory inode is preserved (contents are updated in place),
 *    so no systemd unit or nginx reload is required.
 *
 * Safety: refuses to remove/replace `dev/core` and other dangerous targets.
 * `MIRRORR_WEB_ROOT` may override the destination (defaults to ../dev/web).
 */
import { $ } from "bun";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const appDir = resolve(import.meta.dir, "..");
const repoRoot = resolve(appDir, "..");
const distDir = join(appDir, "dist");
const targetDir = resolve(process.env.MIRRORR_WEB_ROOT ?? join(repoRoot, "dev", "web"));

const out = (line) => process.stdout.write(`${line}\n`);
const fail = (message) => {
  process.stderr.write(`deploy:web: ${message}\n`);
  process.exit(1);
};

const DEV_CORE = join(repoRoot, "dev", "core");
if (
  targetDir === "/" ||
  targetDir === sep ||
  targetDir === repoRoot ||
  targetDir === appDir ||
  targetDir === join(repoRoot, "dev") ||
  DEV_CORE === targetDir ||
  DEV_CORE.startsWith(targetDir + sep)
) {
  fail(`refusing dangerous publish target: ${targetDir}`);
}

out(`deploy:web: building ${relative(repoRoot, appDir)} with MIRRORR_BASE=/`);
const build = await $`bun run build`
  .cwd(appDir)
  .env({ ...process.env, MIRRORR_BASE: "/" })
  .nothrow();
if (build.exitCode !== 0) {
  fail(`build exited with code ${build.exitCode}; nothing was published`);
}

const distIndex = join(distDir, "index.html");
if (!existsSync(distIndex)) {
  fail(`missing build artifact: ${relative(repoRoot, distIndex)}`);
}

const html = readFileSync(distIndex, "utf8");
if (!html.includes("/assets/") || html.includes("/dev/assets/")) {
  fail(
    "dist/index.html does not reference root-absolute /assets/ — refusing to publish a dev-base or asset-less build",
  );
}

// Copy first, prune second: index.html is overwritten before anything is removed.
mkdirSync(targetDir, { recursive: true });
cpSync(distDir, targetDir, { recursive: true });

function collectRelative(root) {
  const found = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      found.add(relative(root, full));
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(root);
  return found;
}

function prune(root, keepRoot) {
  const keep = collectRelative(keepRoot);
  let removed = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (!keep.has(relative(root, full))) {
        rmSync(full, { recursive: true, force: true });
        removed += 1;
      } else if (entry.isDirectory()) {
        walk(full);
      }
    }
  };
  walk(root);
  return removed;
}

const removed = prune(targetDir, distDir);
const published = readdirSync(distDir, { recursive: true }).length;

out(`deploy:web: published ${published} entries into ${relative(repoRoot, targetDir)}`);
if (removed > 0) out(`deploy:web: pruned ${removed} stale entries`);
out("deploy:web: done — static server on 5173 picks this up without a restart");
