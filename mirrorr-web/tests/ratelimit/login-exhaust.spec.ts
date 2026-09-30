import { test } from "@playwright/test"

// Scaffold stub: the real spec deliberately burns the dev API's per-IP login
// budget (10/min) against a live backend (brief KEEP: 429 fixed-window, no
// Retry-After parsing). Skipped until the auth wave lands.
test("login rate-limit fixed window", async () => {
  test.skip(true, "scaffold stub — requires a running backend and the auth wave")
})
