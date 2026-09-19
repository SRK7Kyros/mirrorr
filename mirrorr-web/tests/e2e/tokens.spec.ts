import { expect, test } from "./fixtures"

/**
 * Design-token acceptance (docs/web-frontend-spec.md L55-L113). Values are
 * asserted against the spec hexes, not against the CSS source, so a broken
 * token chain (style not applied, var unresolved) fails here.
 *
 * The assertions run through the shipped primitives — StatusChip, Button,
 * Input and Table, mounted on the Sessions placeholder — rather than through
 * the retired Wave-0 token probe, so they stay non-vacuous as the primitives
 * evolve.
 */
const BG_BASE = "rgb(11, 13, 17)" // --bg-base #0B0D11
const OK = "rgb(52, 199, 123)" // --ok #34C77B

test("body paints --bg-base and the status chip paints --ok", async ({ page }) => {
  const bodyBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(bodyBackground).toBe(BG_BASE)

  const chip = page.locator('[data-testid="status-chip"][data-status="active"]')
  await expect(chip).toBeVisible()
  await expect(chip).toHaveText("Running")
  expect(await chip.evaluate((element) => getComputedStyle(element).color)).toBe(OK)

  const chipDecoration = await chip.evaluate((element) => {
    const style = getComputedStyle(element)
    return { background: style.backgroundColor, border: style.borderTopColor }
  })
  expect(chipDecoration.background).not.toBe("rgba(0, 0, 0, 0)")
  expect(chipDecoration.border).not.toBe("rgba(0, 0, 0, 0)")
})

test("base typography is 13px Inter, with JetBrains Mono available", async ({ page }) => {
  const body = await page.evaluate(() => {
    const style = getComputedStyle(document.body)
    return { size: style.fontSize, family: style.fontFamily }
  })
  expect(body.size).toBe("13px")
  expect(body.family.split(",")[0]?.trim()).toBe("Inter")

  const loaded = await page.evaluate(async () => {
    const results = await Promise.all([
      document.fonts.load('13px "Inter"'),
      document.fonts.load('13px "JetBrains Mono"'),
    ])
    return results.map((faces, index) =>
      index === 0 ? document.fonts.check('13px "Inter"') : document.fonts.check('13px "JetBrains Mono"'),
    )
  })
  expect(loaded).toEqual([true, true])
})

test("the recording pulse runs at 1.6s and stops under reduced motion", async ({ page }) => {
  const pulse = page.getByTestId("status-fixture").getByTestId("pulse-dot")
  const control = page.getByRole("button", { name: "Start recording" })

  const running = await pulse.evaluate((element) => {
    const style = getComputedStyle(element)
    return { name: style.animationName, duration: style.animationDuration }
  })
  expect(running).toEqual({ name: "recording-pulse", duration: "1.6s" })
  expect(await control.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe("0.12s")

  await page.emulateMedia({ reducedMotion: "reduce" })

  await expect.poll(() => pulse.evaluate((element) => getComputedStyle(element).animationName)).toBe("none")
  await expect
    .poll(() => control.evaluate((element) => getComputedStyle(element).transitionDuration))
    .toBe("0s")
})

test("icon-only controls are labelled with a tooltip and icons use token sizes", async ({ page }) => {
  const control = page.getByRole("button", { name: "Start recording" })
  await expect(control).toBeVisible()
  await expect(control).toHaveAttribute("title", "Start recording")

  const iconSize = await control.locator("svg").evaluate((element) => {
    const style = getComputedStyle(element)
    return { width: style.width, height: style.height }
  })
  expect(iconSize).toEqual({ width: "16px", height: "16px" })

  const rowActionIcon = page.getByTestId("table-row").first().locator("button svg")
  const rowIconSize = await rowActionIcon.evaluate((element) => {
    const style = getComputedStyle(element)
    return { width: style.width, height: style.height }
  })
  expect(rowIconSize).toEqual({ width: "14px", height: "14px" })
  expect(await rowActionIcon.getAttribute("stroke-width")).toBe("2")
})

test("the 4px spacing grid drives control, row and dot sizes", async ({ page }) => {
  const control = page.getByRole("button", { name: "Start recording" })
  const controlSize = await control.evaluate((element) => {
    const style = getComputedStyle(element)
    return { width: style.width, height: style.height }
  })
  expect(controlSize).toEqual({ width: "32px", height: "32px" }) // size-8 x 4px

  const row = page.getByTestId("table-row").first()
  expect(await row.evaluate((element) => getComputedStyle(element).height)).toBe("36px") // h-9 x 4px

  const input = page.getByLabel("Search")
  expect(await input.evaluate((element) => getComputedStyle(element).height)).toBe("32px") // h-8 x 4px

  const chipDot = page.locator('[data-testid="status-chip"][data-status="active"] span').first()
  expect(await chipDot.evaluate((element) => getComputedStyle(element).width)).toBe("6px") // size-1.5 x 4px
})
