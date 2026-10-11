import { expect, test } from "./fixtures"

/** A version-1 bundle whose single autorun started long ago. */
const PAST_BUNDLE = {
  version: 1,
  profiles: [],
  autoruns: [
    {
      user_friendly_name: "Past Run",
      snake_case_name: "past-run",
      engine_id: 1,
      resolver_id: 1,
      start_time: "2020-01-01 00:00:00",
      end_time: "2020-01-01 02:00:00",
    },
  ],
}

test.describe("import / export", () => {
  test("stages pasted JSON, warns about already-started items and applies", async ({ page, api }) => {
    api.data.validate = {
      items: [{ name: "Past Run", kind: "autorun", status: "ready", issues: [] }],
    }
    api.data.apply = {
      profiles_created: 1,
      profiles_skipped: 0,
      autoruns_created: 1,
      autoruns_discarded: 1,
      discarded_autoruns: [{ name: "Past Run", start_time: "2020-01-01 00:00:00" }],
    }

    await page.goto("/import-export")

    await page.getByLabel("Pasted bundle JSON").fill(JSON.stringify(PAST_BUNDLE))
    await page.getByRole("button", { name: "Load pasted JSON" }).click()

    // The warning is client-side: it comes from the bundle's own timestamps.
    await expect(page.getByText("1 item has already started and will be skipped")).toBeVisible()
    await expect(page.getByText("Discarded on import: Past Run.")).toBeVisible()

    expect(api.callsTo("/import-export/validate")[0]?.body).toEqual(PAST_BUNDLE)
    await expect(page.getByRole("cell", { name: "Past Run", exact: true })).toBeVisible()

    await page.getByRole("button", { name: "Apply import" }).click()

    await expect(page.getByText("Import complete")).toBeVisible()
    await expect(page.getByText("Discarded 1 already-started: Past Run.")).toBeVisible()
    expect(api.callsTo("/import-export/apply")).toHaveLength(1)
  })

  test("reads a bundle from a URL through the server", async ({ page, api }) => {
    api.data.validate = {
      items: [{ name: "Remote Run", kind: "autorun", status: "ready", issues: [] }],
    }

    await page.goto("/import-export")

    await page.getByLabel("Bundle URL").fill("https://example.com/bundle.json")
    await page.getByRole("button", { name: "Load from URL" }).click()

    // The server fetches it, so the URL travels as a request body, not a nav.
    await expect.poll(() => api.callsTo("/import-export/fetch").length).toBe(1)
    expect(api.callsTo("/import-export/fetch")[0]?.body).toEqual({
      url: "https://example.com/bundle.json",
    })
    await expect(page.getByRole("cell", { name: "Remote Run", exact: true })).toBeVisible()
  })
})
