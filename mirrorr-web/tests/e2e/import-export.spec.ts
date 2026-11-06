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

    // One source at a time: Paste is a mode of the single "Choose a bundle" control.
    await page.getByRole("button", { name: "Paste" }).click()
    await page.getByLabel("Pasted bundle JSON").fill(JSON.stringify(PAST_BUNDLE))
    await page.getByRole("button", { name: "Preview bundle" }).click()

    // The warning is client-side: it comes from the bundle's own timestamps.
    await expect(page.getByText("1 item has already started and will be skipped")).toBeVisible()
    await expect(page.getByText("Discarded on import: Past Run.")).toBeVisible()

    expect(api.callsTo("/import-export/validate")[0]?.body).toEqual(PAST_BUNDLE)
    await expect(page.getByRole("cell", { name: "Past Run", exact: true })).toBeVisible()
    await expect(page.getByText("1 of 1 selected").first()).toBeVisible()

    await page.getByRole("button", { name: "Import 1 item" }).click()

    await expect(page.locator("#page-main").getByText("Import complete")).toBeVisible()
    await expect(page.getByText("Discarded 1 already-started: Past Run.")).toBeVisible()
    expect(api.callsTo("/import-export/apply")).toHaveLength(1)
  })

  test("reads a bundle from a URL through the server", async ({ page, api }) => {
    api.data.validate = {
      items: [{ name: "Remote Run", kind: "autorun", status: "ready", issues: [] }],
    }

    await page.goto("/import-export")

    await page.getByRole("button", { name: "URL" }).click()
    await page.getByLabel("Bundle URL").fill("https://example.com/bundle.json")
    await page.getByRole("button", { name: "Load", exact: true }).click()

    // The server fetches it, so the URL travels as a request body, not a nav.
    await expect.poll(() => api.callsTo("/import-export/fetch").length).toBe(1)
    expect(api.callsTo("/import-export/fetch")[0]?.body).toEqual({
      url: "https://example.com/bundle.json",
    })
    await expect(page.getByRole("cell", { name: "Remote Run", exact: true })).toBeVisible()
  })

  test("previews counts, leaves a name collision out until it is settled", async ({ page, api }) => {
    api.data.validate = {
      items: [
        { name: "Speedcubing", kind: "profile", status: "ready", issues: [] },
        {
          name: "F1 Weekend",
          kind: "profile",
          status: "ready",
          issues: [{ problem: "name_conflict", existing_id: 5, new_name: "F1 Weekend_2" }],
        },
      ],
    }

    await page.goto("/import-export")
    await page.getByRole("button", { name: "Paste" }).click()
    await page.getByLabel("Pasted bundle JSON").fill(JSON.stringify(PAST_BUNDLE))
    await page.getByRole("button", { name: "Preview bundle" }).click()

    // The badge says Conflict, and the default is out — not in.
    await expect(page.getByText("2 profiles").first()).toBeVisible()
    await expect(page.getByText("1 of 2 selected").first()).toBeVisible()
    await expect(page.getByRole("checkbox", { name: "Include F1 Weekend" })).not.toBeChecked()
    // Default is Skip: the installed profile is left exactly as it is.
    const conflictRow = page.getByRole("row", { name: /F1 Weekend/ })
    await expect(conflictRow.getByText("Leaves “F1 Weekend” untouched.")).toBeVisible()

    const conflict = page.getByRole("group", { name: "Name conflict for F1 Weekend" })
    await conflict.getByRole("button", { name: "Keep both" }).click()

    await expect(
      conflictRow.getByText("Imports alongside it as “F1 Weekend_2”."),
    ).toBeVisible()
    await expect(page.getByRole("checkbox", { name: "Include F1 Weekend" })).toBeChecked()
    await expect(page.getByText("2 of 2 selected").first()).toBeVisible()
    await expect(page.getByRole("button", { name: "Import 2 items" })).toBeEnabled()
  })

  test("cannot apply an empty selection and says why", async ({ page, api }) => {
    api.data.validate = {
      items: [{ name: "Speedcubing", kind: "profile", status: "ready", issues: [] }],
    }

    await page.goto("/import-export")
    await page.getByRole("button", { name: "Paste" }).click()
    await page.getByLabel("Pasted bundle JSON").fill(JSON.stringify(PAST_BUNDLE))
    await page.getByRole("button", { name: "Preview bundle" }).click()

    await page.getByRole("checkbox", { name: "Include Speedcubing" }).click()

    await expect(page.getByText("Select at least one item to import.")).toBeVisible()
    await expect(page.getByRole("button", { name: "Import 0 items" })).toBeDisabled()
  })

  test("keeps the collision decision reachable on a phone", async ({ page, api }) => {
    api.data.validate = {
      items: [
        { name: "Speedcubing", kind: "profile", status: "ready", issues: [] },
        {
          name: "F1 Weekend",
          kind: "profile",
          status: "ready",
          issues: [{ problem: "name_conflict", existing_id: 5, new_name: "F1 Weekend_2" }],
        },
      ],
    }

    await page.setViewportSize({ width: 375, height: 900 })
    await page.goto("/import-export")
    await page.getByRole("button", { name: "Paste" }).click()
    await page.getByLabel("Pasted bundle JSON").fill(JSON.stringify(PAST_BUNDLE))
    await page.getByRole("button", { name: "Preview bundle" }).click()

    // Below 672 px the row becomes a card: the resolution column must not clip.
    await expect(page.getByRole("checkbox", { name: "Include F1 Weekend" })).toBeVisible()
    const conflict = page.getByRole("group", { name: "Name conflict for F1 Weekend" })
    await expect(conflict).toBeVisible()
    await conflict.getByRole("button", { name: "Keep both" }).click()
    await expect(page.getByRole("button", { name: "Import 2 items" })).toBeEnabled()
  })

  test("export lists the real items and refuses an empty selection", async ({ page, api }) => {
    api.data.profiles = [
      {
        id: 1,
        name: "F1 Weekend",
        default_engine_id: 1,
        resolver_id: 1,
        engine_name: "Streamlink",
        resolver_name: "Wide IPTV",
      },
    ]
    api.data.autoruns = []

    await page.goto("/import-export")

    // The lie this replaces: "No profiles to export" while a profile exists.
    await expect(page.getByRole("checkbox", { name: "Export F1 Weekend" })).toBeVisible()
    await expect(page.getByText("No autoruns yet — nothing of this type to export.")).toBeVisible()
    await expect(page.getByText("No profiles yet — nothing of this type to export.")).toHaveCount(0)

    await expect(page.getByRole("button", { name: "Export selected" })).toBeDisabled()
    await expect(page.getByText("Select at least one profile or autorun to export.")).toBeVisible()

    await page.getByRole("checkbox", { name: "Export F1 Weekend" }).check()
    await expect(page.getByRole("button", { name: "Export selected" })).toBeEnabled()
    await expect(page.getByText("1 of 1 selected")).toBeVisible()
  })
})
