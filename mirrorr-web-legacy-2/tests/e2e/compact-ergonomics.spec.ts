import path from "node:path"
import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"

const EVIDENCE_DIR = path.resolve(import.meta.dirname, "../../../.omo/evidence")
const COMPACT_FLOOR_PX = 44

const INTERACTIVE_SELECTOR = [
  "button",
  '[role="button"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="tab"]',
  "input",
  "select",
  "textarea",
  "summary",
].join(", ")

interface TargetBox {
  readonly label: string
  readonly width: number
  readonly height: number
}

async function sweepTargets(page: Page): Promise<TargetBox[]> {
  return page.evaluate((selector) => {
    const results: { label: string; width: number; height: number }[] = []
    for (const node of Array.from(document.querySelectorAll(selector))) {
      const element = node as HTMLElement
      const rect = element.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      const style = getComputedStyle(element)
      if (style.visibility === "hidden" || style.display === "none") continue
      const testId = element.getAttribute("data-testid")
      const text = (element.textContent ?? "").trim().slice(0, 24)
      results.push({
        label: testId ?? `${element.tagName.toLowerCase()}:${text}`,
        width: rect.width,
        height: rect.height,
      })
    }
    return results
  }, INTERACTIVE_SELECTOR)
}

function undersized(targets: readonly TargetBox[]): TargetBox[] {
  return targets.filter((target) => target.width < COMPACT_FLOOR_PX || target.height < COMPACT_FLOOR_PX)
}

function collectWrites(page: Page): string[] {
  const writes: string[] = []
  page.on("request", (request) => {
    // The session's own token refresh is not a data mutation.
    if (request.method() === "GET" || request.url().includes("/auth/refresh")) return
    writes.push(`${request.method()} ${request.url()}`)
  })
  return writes
}

test.describe("compact touch ergonomics at 390x844", () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test("every interactive element on sessions and settings clears the 44px floor", async ({ page }) => {
    const routes = [
      { path: "/sessions", ready: "sessions-view", shot: "task-25-ergonomics-sessions-390x844.png" },
      { path: "/settings", ready: "settings-view", shot: "task-25-ergonomics-settings-390x844.png" },
    ] as const

    for (const route of routes) {
      await page.goto(route.path)
      await expect(page.getByTestId(route.ready)).toBeVisible()

      const targets = await sweepTargets(page)
      expect(targets.length, `${route.path} exposes interactive targets`).toBeGreaterThan(0)
      expect(
        undersized(targets).map((target) => `${target.label} ${target.width}x${target.height}`),
        `${route.path} targets under ${COMPACT_FLOOR_PX}px`,
      ).toEqual([])

      await page.screenshot({ path: path.join(EVIDENCE_DIR, route.shot) })
    }
  })

  test("the sweep catches a deliberately undersized control", async ({ page }) => {
    await page.goto("/sessions")
    await expect(page.getByTestId("sessions-view")).toBeVisible()

    await page.evaluate(() => {
      const probe = document.createElement("button")
      probe.setAttribute("data-testid", "undersized-probe")
      probe.textContent = "probe"
      probe.style.cssText = "min-height:0;min-width:0;height:20px;width:20px;padding:0"
      document.querySelector('[data-testid="compact-scroll"]')?.appendChild(probe)
    })

    const targets = await sweepTargets(page)
    expect(undersized(targets).map((target) => target.label)).toContain("undersized-probe")

    await page.reload()
    await expect(page.getByTestId("sessions-view")).toBeVisible()
    await expect(page.getByTestId("undersized-probe")).toHaveCount(0)
  })

  test("a synthetic Capacitor keyboard event drives --keyboard-inset", async ({ page }) => {
    await page.goto("/sessions")
    await expect(page.getByTestId("sessions-view")).toBeVisible()

    const readInset = (): Promise<string> =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--keyboard-inset").trim(),
      )
    const readBottomPadding = (): Promise<number> =>
      page.evaluate(() => {
        const region = document.querySelector('[data-testid="compact-scroll"]')
        return region === null ? 0 : Number.parseFloat(getComputedStyle(region).paddingBottom)
      })

    expect(await readInset()).toBe("")
    const paddingBefore = await readBottomPadding()

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("keyboardWillShow", { detail: { keyboardHeight: 300 } }))
    })
    expect(await readInset()).toBe("300px")
    expect((await readBottomPadding()) - paddingBefore).toBe(300)

    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-25-keyboard-inset-390x844.png") })

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("keyboardWillHide", { detail: {} }))
    })
    expect(await readInset()).toBe("0px")
    expect(await readBottomPadding()).toBe(paddingBefore)
  })

  test("swipe-down dismisses a sheet without writing", async ({ page }) => {
    await page.goto("/sessions")
    await expect(page.getByTestId("sessions-view")).toBeVisible()

    const writes = collectWrites(page)

    await page.getByTestId("compact-tab-more").click()
    await expect(page.getByTestId("compact-more-sheet")).toBeVisible()

    const box = await page.getByRole("dialog").boundingBox()
    expect(box).not.toBeNull()
    const startX = (box?.x ?? 0) + (box?.width ?? 0) / 2
    const startY = (box?.y ?? 0) + 24

    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX, startY + 120, { steps: 6 })
    await page.mouse.up()

    await expect(page.getByTestId("compact-more-sheet")).toHaveCount(0)
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-25-sheet-dismissed-390x844.png") })

    expect(writes).toEqual([])
  })

  test("dialogs present as bottom sheets with a 6px top radius and a drag handle", async ({ page }) => {
    await page.goto("/sessions")
    await expect(page.getByTestId("sessions-view")).toBeVisible()

    await page.getByTestId("compact-tab-more").click()
    const panel = page.getByRole("dialog")
    await expect(panel).toBeVisible()
    await expect(page.getByTestId("sheet-drag-handle")).toBeVisible()

    const box = await panel.boundingBox()
    const viewport = page.viewportSize()
    expect(box).not.toBeNull()
    expect(viewport).not.toBeNull()
    expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(viewport?.height)
    expect(box?.x).toBe(0)
    expect(box?.width).toBe(viewport?.width)

    expect(await panel.evaluate((node) => getComputedStyle(node).borderTopLeftRadius)).toBe("6px")
    expect(await panel.evaluate((node) => getComputedStyle(node).borderBottomLeftRadius)).toBe("0px")

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, "task-26-sheet-presentation-390x844.png"),
    })
  })

  test("pull-to-refresh arms at 64px and only issues reads", async ({ page }) => {
    await page.goto("/sessions")
    await expect(page.getByTestId("sessions-view")).toBeVisible()

    const writes = collectWrites(page)
    const reads: string[] = []
    page.on("request", (request) => {
      if (request.method() === "GET") reads.push(request.url())
    })

    const box = await page.getByTestId("compact-scroll").boundingBox()
    expect(box).not.toBeNull()
    const x = (box?.x ?? 0) + (box?.width ?? 0) / 2
    const y = (box?.y ?? 0) + 40

    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, y + 40, { steps: 4 })
    await expect(page.getByTestId("pull-to-refresh-indicator")).toHaveText("Pull to refresh")
    await page.mouse.move(x, y + 120, { steps: 6 })
    await expect(page.getByTestId("pull-to-refresh-indicator")).toHaveText("Release to refresh")
    await page.mouse.up()

    await expect(page.getByTestId("pull-to-refresh-indicator")).toHaveCount(0)
    expect(writes).toEqual([])
    expect(reads.length).toBeGreaterThan(0)
  })
})
