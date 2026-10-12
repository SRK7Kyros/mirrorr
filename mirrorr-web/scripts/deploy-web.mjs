#!/usr/bin/env bun
/**
 * deploy-web — build both surfaces and publish them next to the core.
 *
 * The standard build lands in <deploy root>/web (`location /` -> root run/web)
 * and the admin build in <deploy root>/admin, which nginx gates behind the API's
 * admin check. The deploy root is `run/` when MIRRORR_DEPLOY_ROOT is set (see
 * deploy/deploy.sh) and falls back to `../dev` for a bare local build.
 * Both are plain file syncs: no nginx reload and no service restart. rsync
 * copies first and prunes stale fingerprinted assets afterwards, so a live page
 * never points at a file that has already been removed.
 *
 * Usage: bun run deploy:web
 *
 * Preview: `MIRRORR_PREVIEW=1 bun run deploy:preview` (with MIRRORR_DEPLOY_ROOT
 * set) builds the branch as one standard surface with `base=/dev/` and
 * publishes it to <deploy root>/dev, which nginx serves at `<url>/dev/`; the
 * live `web`/`admin` builds are left untouched.
 */
import { readdirSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";

const appDir = resolve(import.meta.dir, "..");
const distDir = join(appDir, "dist");

const deployRoot = process.env.MIRRORR_DEPLOY_ROOT
  ? resolve(process.env.MIRRORR_DEPLOY_ROOT)
  : resolve(appDir, "..", "dev");

// Default `/dev/` matches the nginx `/dev/` location in deploy/mirrorr.conf.
const PREVIEW_BASE = process.env.MIRRORR_PREVIEW_BASE ?? "/dev/";

// `MIRRORR_PREVIEW=1` publishes ONE standard build under a path prefix instead
// of the live pair, so an unmerged branch can be eyeballed in a real browser
// without touching `web`/`admin`.
const SURFACES = process.env.MIRRORR_PREVIEW
  ? [{ surface: "standard", base: PREVIEW_BASE, target: join(deployRoot, "dev") }]
  : [
      { surface: "standard", base: "/", target: join(deployRoot, "web") },
      // Vite names an emitted HTML file after its source, so the admin entry
      // arrives as admin.html and is published under the conventional index.html.
      { surface: "admin", base: "/admin/", target: join(deployRoot, "admin"), entry: "admin.html" },
    ];

function step(cmd, env) {
  const proc = Bun.spawnSync(cmd, {
    cwd: appDir,
    env: { ...process.env, ...env },
    stdout: "inherit",
    stderr: "inherit",
  });
  if (proc.exitCode !== 0) {
    console.error(`[deploy-web] FAILED (exit ${proc.exitCode}): ${cmd.join(" ")}`);
    process.exit(proc.exitCode ?? 1);
  }
}

for (const { surface, base, target, entry } of SURFACES) {
  console.log(`[deploy-web] building ${surface} with MIRRORR_BASE=${base} ...`);
  step(["bun", "run", "build"], { MIRRORR_BASE: base, MIRRORR_SURFACE: surface });

  console.log(`[deploy-web] syncing ${distDir} -> ${target}`);
  step(["rsync", "-a", "--delete", `${distDir}/`, `${target}/`]);

  if (entry !== undefined) renameSync(join(target, entry), join(target, "index.html"));

  const assets = readdirSync(join(distDir, "assets")).length;
  console.log(`[deploy-web] ${surface}: ${assets} assets published to ${target}`);
}
