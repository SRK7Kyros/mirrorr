/**
 * Task 15 e2e — V7 `/recordings` (spec L303-L322).
 *
 * Real path: this dev core has no `--web-url` and no recordings, so the view
 * must render the degraded state the core really serves — the empty-state hint
 * and no media surface at all (nothing fabricated). Stubbed paths pin the
 * per-card contract the core cannot produce here: the empty-`content_url`
 * hint, the link-out-only footer with its 44px Open anchor, the permanent
 * deletion confirmation, and the once-per-session HEAD probe with its
 * unreachable toast plus `?highlight`.
 */
import path from "node:path"
import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"

const EVIDENCE_DIR = path.resolve(import.meta.dirname, "../../../.omo/evidence")

test.use({ permissions: ["clipboard-read", "clipboard-write"] })

interface RecordingSeed {
  readonly id: number
  readonly user_friendly_name: string
  readonly snake_case_name: string
  readonly content_url: string
  readonly profile_name: string
  readonly engine_name: string
  readonly resolver_name: string
  readonly duration_seconds: number
  readonly size_bytes: number
  readonly created_at: string
}

const MEDIA_RECORDING: RecordingSeed = {
  id: 5,
  user_friendly_name: "Morning capture",
  snake_case_name: "morning_capture",
  content_url: "/media/morning.m3u8",
  profile_name: "p2",
  engine_name: "yt_dlp_piped",
  resolver_name: "static",
  duration_seconds: 65,
  size_bytes: 12_900_000,
  created_at: "2026-09-19T10:00:00",
}

const OTHER_MEDIA_RECORDING: RecordingSeed = {
  ...MEDIA_RECORDING,
  id: 6,
  user_friendly_name: "Evening capture",
  snake_case_name: "evening_capture",
  content_url: "/media/evening.m3u8",
}

const NO_MEDIA_RECORDING: RecordingSeed = {
  ...MEDIA_RECORDING,
  id: 7,
  user_friendly_name: "Silent capture",
  snake_case_name: "silent_capture",
  content_url: "",
}

interface StubState {
  readonly deleted: Set<number>
  readonly deleteCalls: string[]
  headCalls: number
  headStatus: number
}

function createState(headStatus = 200): StubState {
  return { deleted: new Set(), deleteCalls: [], headCalls: 0, headStatus }
}

async function stubRecordings(page: Page, state: StubState): Promise<void> {
  await page.route("**/api/recordings/**", async (route) => {
    const request = route.request()
    if (request.method() === "DELETE") {
      const id = Number(request.url().split("/").pop())
      state.deleted.add(id)
      state.deleteCalls.push(request.url())
      await route.fulfill({ json: { status: "deleted", deleted: { recordings: 1 } } })
      return
    }
    const items = [MEDIA_RECORDING, OTHER_MEDIA_RECORDING, NO_MEDIA_RECORDING].filter(
      (item) => !state.deleted.has(item.id),
    )
    await route.fulfill({ json: { items, next_cursor: null, has_more: false } })
  })
  await page.route("**/media/**", async (route) => {
    state.headCalls += 1
    await route.fulfill({ status: state.headStatus, body: "" })
  })
  await page.addInitScript(() => {
    window.open = () => null
  })
}

test("real: the recordings view renders the core's degraded empty state (no web_url)", async ({ page }) => {
  await page.goto("/recordings")
  await expect(page.getByTestId("recordings-view")).toBeVisible()
  await expect(page.getByText("No recordings yet — enable recording on a session")).toBeVisible()
  await expect(page.locator("video")).toHaveCount(0)
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-15-recordings-real-empty.png") })
})

test("stub: media cards link out and the empty content_url renders the muted hint", async ({ page }) => {
  const state = createState()
  await stubRecordings(page, state)

  await page.goto("/recordings")
  const mediaCard = page.getByTestId("recording-card-5")
  await expect(mediaCard).toBeVisible()
  await expect(mediaCard.getByText("Morning capture")).toBeVisible()
  await expect(mediaCard.getByText("morning_capture")).toBeVisible()
  await expect(mediaCard.getByText("1:05")).toBeVisible()
  await expect(mediaCard.getByText(/MB/)).toBeVisible()

  const open = mediaCard.getByRole("link", { name: "Open" })
  await expect(open).toHaveAttribute("target", "_blank")
  await expect(open).toHaveClass(/h-11/)
  await expect(page.locator("video")).toHaveCount(0)

  const noMediaCard = page.getByTestId("recording-card-7")
  await expect(noMediaCard.getByText("Media not served on this install")).toBeVisible()
  await expect(noMediaCard.getByRole("link", { name: "Open" })).toHaveCount(0)

  await mediaCard.getByRole("button", { name: "Copy link" }).click()
  await expect(page.getByText("Link copied")).toBeVisible()
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-15-recordings-cards.png") })
})

test("stub: delete confirms with the permanent-deletion copy and drops the card", async ({ page }) => {
  test.setTimeout(60_000)
  const state = createState()
  await stubRecordings(page, state)

  await page.goto("/recordings")
  await page.getByRole("button", { name: "Delete Morning capture" }).click()
  await expect(page.getByText('Delete "Morning capture"?')).toBeVisible()
  await expect(page.getByText("Permanently deletes the file")).toBeVisible()
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-15-recordings-delete-confirm.png") })

  await page.getByRole("button", { name: "Delete recording" }).click()
  expect(state.deleteCalls.some((url) => url.endsWith("/api/recordings/5"))).toBe(true)
  await expect(page.getByTestId("recording-card-5")).toHaveCount(0, { timeout: 25_000 })
})

test("stub: one HEAD probe per session with the unreachable toast, and ?highlight rings the card", async ({ page }) => {
  const state = createState(404)
  await stubRecordings(page, state)

  await page.goto("/recordings?highlight=6")
  const highlighted = page.getByTestId("recording-card-6")
  await expect(highlighted).toHaveAttribute("data-highlighted", "true")
  await expect(highlighted).not.toHaveAttribute("data-highlighted", "true", { timeout: 5_000 })

  await page.getByTestId("recording-card-5").getByRole("link", { name: "Open" }).click()
  await expect(page.getByText("Media not reachable — file may not be served")).toBeVisible()
  expect(state.headCalls).toBe(1)

  await page.getByTestId("recording-card-6").getByRole("link", { name: "Open" }).click()
  expect(state.headCalls).toBe(1)
  await expect(page.getByText("Media not reachable — file may not be served")).toHaveCount(1)
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "task-15-recordings-probe.png") })
})
