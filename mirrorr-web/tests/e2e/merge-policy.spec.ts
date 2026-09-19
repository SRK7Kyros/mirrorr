import { mkdirSync } from "node:fs"
import path from "node:path"
import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"

/**
 * Real-browser evidence for the id-keyed entity merge store and the optimistic
 * policies (todo 10). The temporary `MergeProbe` on `/dev/data-probe` mounts
 * the real `EntityStore` over the real TanStack Query cache, so these specs
 * exercise the actual DOM the views will render from the same precedence.
 *
 * The probe is scaffolding and is removed in Wave 2 (todo 12).
 */
const EVIDENCE_DIR = path.resolve(import.meta.dirname, "../../../.omo/evidence")

const SESSION_PAGE = {
  items: [{ id: 7, status: "recording", record: true, engine_id: 1, resolver_id: 1, profile_id: 1 }],
  next_cursor: null,
  has_more: false,
}

const CATALOGS: Readonly<Record<string, readonly { id: number; name: string }[]>> = {
  engines: [{ id: 1, name: "Engine Alpha" }],
  resolvers: [{ id: 1, name: "Resolver One" }],
  profiles: [{ id: 1, name: "Profile Default" }],
}

/** Keeps the sibling DataProbe deterministic; the merge probe seeds locally. */
async function seedDataProbe(page: Page): Promise<void> {
  await page.route("**/api/sessions/*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "cache-control": "no-store" },
      body: JSON.stringify(SESSION_PAGE),
    }),
  )

  for (const [kind, items] of Object.entries(CATALOGS)) {
    await page.route(`**/api/${kind}/*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
        body: JSON.stringify({ items, next_cursor: null, has_more: false }),
      }),
    )
  }
}

test.beforeAll(() => {
  mkdirSync(EVIDENCE_DIR, { recursive: true })
})

test("a create response plus its WS echo render exactly one row in both arrival orders", async ({
  page,
}) => {
  await seedDataProbe(page)
  await page.goto("/dev/data-probe")

  await expect(page.getByTestId("merge-probe")).toBeVisible()
  await expect(page.getByTestId("merge-row")).toHaveCount(1)
  await expect(page.getByTestId("merge-count-42")).toHaveText("0")
  await expect(page.getByTestId("merge-count-43")).toHaveText("0")

  // Arrival order 1: HTTP create response first, WS echo second.
  await page.getByTestId("merge-create-http-first").click()
  // Arrival order 2: WS echo first, HTTP create response second.
  await page.getByTestId("merge-create-ws-first").click()

  // Raw cache occurrences: exactly one row per id in both orders.
  await expect(page.getByTestId("merge-count-42")).toHaveText("1")
  await expect(page.getByTestId("merge-count-43")).toHaveText("1")
  await expect(page.getByTestId("merge-row")).toHaveCount(3)

  const row42 = page.locator('[data-testid="merge-row"][data-id="42"]')
  const row43 = page.locator('[data-testid="merge-row"][data-id="43"]')
  await expect(row42).toHaveCount(1)
  await expect(row43).toHaveCount(1)
  // The WS echo (recording) wins over the HTTP response (active) in both orders.
  await expect(row42.getByTestId("merge-status")).toHaveText("recording")
  await expect(row43.getByTestId("merge-status")).toHaveText("recording")

  await page.screenshot({
    path: path.join(EVIDENCE_DIR, "task-10-merge-single-row.png"),
    fullPage: true,
  })
})

test("a 409 on the recording toggle flips optimistically and restores the previous value", async ({
  page,
}) => {
  await seedDataProbe(page)
  await page.goto("/dev/data-probe")

  const toggleValue = page.getByTestId("merge-toggle-value")
  await expect(toggleValue).toHaveText("recording on")

  await page.getByTestId("merge-toggle-409").click()

  // The optimistic overlay moves the value before the server answers...
  await expect(toggleValue).toHaveText("recording off")
  // ...and the 409 drops the overlay, restoring the authoritative value.
  await expect(toggleValue).toHaveText("recording on")
  await expect(page.getByTestId("merge-pending")).toHaveText("none")

  await page.screenshot({
    path: path.join(EVIDENCE_DIR, "task-10-merge-409-revert.png"),
    fullPage: true,
  })
})
