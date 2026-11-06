import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "../e2e/fixtures"
import { SCENARIOS, openScenario } from "./scenarios"

/**
 * Accessibility gate: axe on every screen the gallery photographs, plus WCAG
 * 2.2's target-size criterion (2.5.8) measured on the rendered DOM.
 *
 * Both are run at every viewport because the console reflows at 768: a control
 * that clears 24 px on a desktop can be 18 px on a phone, and a 375-only
 * regression is invisible to a single-wide suite.
 *
 * Rules excluded from axe on purpose (each would need a product decision, not a
 * markup fix):
 *   - `region` is a best-practice rule, not WCAG — it objects to the auth
 *     screens' bare centred card, which is the intended layout.
 */

/** WCAG A/AA only: adding best-practice rules would make the gate a style review. */
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"]

/**
 * Target-size sweep, evaluated in the page.
 *
 * Implements the two exceptions the criterion allows rather than blanket-passing
 * small controls: an inline link inside a sentence, and a target whose 24 px
 * circle touches no other target (the "spacing" exception). Everything else is
 * reported with its measured box.
 */
const TARGET_SIZE_SWEEP = `(() => {
  const MIN = 24;
  const SELECTOR = [
    "a[href]",
    "button",
    "input:not([type=hidden])",
    "select",
    "textarea",
    "summary",
    '[role="button"]',
    '[role="link"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="menuitemcheckbox"]',
    '[role="option"]',
    '[role="checkbox"]',
    '[role="switch"]',
    '[role="radio"]',
    '[tabindex]:not([tabindex="-1"])'
  ].join(",");

  const describe = (el) => {
    const explicit = el.getAttribute("aria-label");
    if (explicit) return explicit;
    const text = (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 60);
    if (text) return text;
    return el.tagName.toLowerCase();
  };

  const visible = Array.from(document.querySelectorAll(SELECTOR))
    .map((el) => ({ el, rect: el.getBoundingClientRect() }))
    .filter(({ el, rect }) => {
      if (rect.width === 0 || rect.height === 0) return false;
      const style = getComputedStyle(el);
      return style.visibility !== "hidden" && style.opacity !== "0";
    });

  const failures = [];
  for (const { el, rect } of visible) {
    if (rect.width >= MIN && rect.height >= MIN) continue;

    if (el.tagName === "A") {
      // Inline exception: a link inside a sentence.
      const parentText = (el.parentElement && el.parentElement.textContent) || "";
      if (getComputedStyle(el).display === "inline" && parentText.trim().length > (el.textContent || "").trim().length) continue;
    }

    // A control whose visible target is the <label> around it.
    const label = el.closest("label");
    if (label) {
      const labelRect = label.getBoundingClientRect();
      if (labelRect.width >= MIN && labelRect.height >= MIN) continue;
    }

    // Spacing exception: a 24px circle centred on this box must reach no other target.
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const collides = visible.some((other) => {
      if (other.el === el || other.el.contains(el) || el.contains(other.el)) return false;
      const box = other.rect;
      const dx = Math.max(box.left - cx, 0, cx - box.right);
      const dy = Math.max(box.top - cy, 0, cy - box.bottom);
      return Math.sqrt(dx * dx + dy * dy) < 12;
    });
    if (!collides) continue;

    failures.push({
      target: describe(el),
      html: el.outerHTML.slice(0, 160),
      width: Math.round(rect.width * 10) / 10,
      height: Math.round(rect.height * 10) / 10
    });
  }

  return failures;
})()`

for (const scenario of SCENARIOS) {
  if (scenario.skipA11y === true) continue

  test(`a11y: ${scenario.name}`, async ({ page, api }, testInfo) => {
    const viewport = testInfo.project.name.replace(/^v/, "")
    if (scenario.viewports !== undefined && !scenario.viewports.includes(viewport)) {
      test.skip()
      return
    }
    if (scenario.anonymous === true) api.data.authenticated = false
    if (scenario.data !== undefined) Object.assign(api.data, scenario.data)

    await openScenario(page, scenario)
    if (scenario.prepare !== undefined) {
      await scenario.prepare(page)
      await page.waitForTimeout(120)
    }

    const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
    expect(
      results.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes.map((node) => node.target.join(" ")),
      })),
    ).toEqual([])

    // The sweep reads live rectangles, so it must read a settled layout: fonts
    // loaded and two frames drawn. Without this a scenario that swaps its
    // skeleton for content can be measured mid-swap and report a target that is
    // only briefly small (observed once on profiles-list at 375, green on rerun).
    await page.evaluate("document.fonts.ready")
    await page.evaluate(
      "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    )
    const undersized = (await page.evaluate(TARGET_SIZE_SWEEP)) as readonly {
      target: string
      html: string
      width: number
      height: number
    }[]
    expect(undersized).toEqual([])
  })
}
