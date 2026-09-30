#!/usr/bin/env bun
/**
 * deploy-web — build with MIRRORR_BASE=/ and publish dist/ into ../dev/web.
 *
 * nginx serves that directory straight from disk (`location /` -> root
 * dev/web), so a deploy is a plain file sync: no nginx reload and no
 * service restart. rsync copies first and prunes stale fingerprinted
 * assets afterwards, so a live page never points at a file that has
 * already been removed.
 *
 * Usage: bun run deploy:web
 */
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const appDir = resolve(import.meta.dir, "..");
const distDir = join(appDir, "dist");
const targetDir = resolve(appDir, "..", "dev", "web");

function step(cmd) {
  const proc = Bun.spawnSync(cmd, {
    cwd: appDir,
    env: { ...process.env, MIRRORR_BASE: "/" },
    stdout: "inherit",
    stderr: "inherit",
  });
  if (proc.exitCode !== 0) {
    console.error(`[deploy-web] FAILED (exit ${proc.exitCode}): ${cmd.join(" ")}`);
    process.exit(proc.exitCode ?? 1);
  }
}

console.log("[deploy-web] building with MIRRORR_BASE=/ ...");
step(["bun", "run", "build"]);

console.log(`[deploy-web] syncing ${distDir} -> ${targetDir}`);
step(["rsync", "-a", "--delete", `${distDir}/`, `${targetDir}/`]);

const assets = readdirSync(join(distDir, "assets")).length;
console.log(`[deploy-web] done — ${assets} assets published to ${targetDir}`);
