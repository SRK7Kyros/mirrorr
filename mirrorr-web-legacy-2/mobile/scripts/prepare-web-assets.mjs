import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const webRoot = path.resolve(mobileRoot, "..")
const webDist = path.join(webRoot, "dist")
const mobileDist = path.join(mobileRoot, "dist")
const webMobileHtml = path.join(webDist, "mobile.html")
const indexHtml = path.join(mobileDist, "index.html")
const mobileHtmlCopy = path.join(mobileDist, "mobile.html")

await rm(mobileDist, { recursive: true, force: true })
await mkdir(mobileDist, { recursive: true })
await cp(webDist, mobileDist, { recursive: true })

// The wrapper build is viewport-locked (maximum-scale=1.0, user-scalable=no) so
// pinch reaches the grid instead of page-zoom; the browser build keeps page-zoom.
// mirrorr-web/mobile.html is the source, mobile/dist/index.html the artifact.
const html = await readFile(webMobileHtml, "utf8")
await writeFile(indexHtml, html)
await rm(mobileHtmlCopy, { force: true })

console.log(`mobile assets: ${path.relative(webRoot, indexHtml)} written from dist/mobile.html`)
