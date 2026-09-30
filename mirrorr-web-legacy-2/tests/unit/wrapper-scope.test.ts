import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The out-of-scope list (spec L617-L626) asserted as absent: no push
 * registration, no service worker, no background sync, no native player, no
 * commerce. A dependency or a source reference is the only way any of them could
 * arrive, so both are checked.
 *
 * Lives under tests/unit because it reads the filesystem: `tsconfig.app.json`
 * covers `src` with `vite/client` types only.
 */
const OUT_OF_SCOPE_DEPENDENCIES = [
  "push-notifications",
  "firebase",
  "onesignal",
  "background-task",
  "background-fetch",
  "in-app-purchase",
  "revenuecat",
  "shaka-player",
  "video.js",
  "hls.js",
  "workbox",
]

const OUT_OF_SCOPE_SOURCE_MARKERS = ["serviceWorker", "pushManager", "BackgroundFetch", "registerForPush"]

const webRoot = path.resolve(import.meta.dirname, "../..")

function declaredDependencies(): string[] {
  const manifest = JSON.parse(readFileSync(path.join(webRoot, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  return Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })
}

function readSources(dir: string): string {
  const chunks: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) chunks.push(readSources(full))
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes(".test.")) {
      chunks.push(readFileSync(full, "utf8"))
    }
  }
  return chunks.join("\n")
}

describe("wrapper scope guards", () => {
  it("ships no push, service-worker, background-sync or native-player dependency", () => {
    const offenders = declaredDependencies().filter((name) =>
      OUT_OF_SCOPE_DEPENDENCIES.some((banned) => name.includes(banned)),
    )
    expect(offenders).toEqual([])
  })

  it("references no service worker, push subscription or background fetch in the source", () => {
    const source = readSources(path.join(webRoot, "src"))
    const found = OUT_OF_SCOPE_SOURCE_MARKERS.filter((marker) => source.includes(marker))
    expect(found).toEqual([])
  })

  it("declares no deep-link or app-url configuration", () => {
    const config = readFileSync(path.join(webRoot, "capacitor.config.ts"), "utf8")
    expect(config).not.toContain("appUrlOpen")
    expect(config).not.toContain("appLinks")
    expect(config).not.toContain("deepLinks")
  })
})
