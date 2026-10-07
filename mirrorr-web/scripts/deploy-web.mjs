#!/usr/bin/env bun
/**
 * deploy-web — build both surfaces and publish them next to the core.
 *
 * The standard build lands in ../dev/web (`location /` -> root dev/web) and the
 * admin build in ../dev/admin, which nginx gates behind the API's admin check.
 * Both are plain file syncs: no nginx reload and no service restart. rsync
 * copies first and prunes stale fingerprinted assets afterwards, so a live page
 * never points at a file that has already been removed.
 *
 * Usage: bun run deploy:web
 */
import { readdirSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";

const appDir = resolve(import.meta.dir, "..");
const distDir = join(appDir, "dist");

const SURFACES = [
  { surface: "standard", base: "/", target: resolve(appDir, "..", "dev", "web") },
  // Vite names an emitted HTML file after its source, so the admin entry
  // arrives as admin.html and is published under the conventional index.html.
  { surface: "admin", base: "/admin/", target: resolve(appDir, "..", "dev", "admin"), entry: "admin.html" },
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
