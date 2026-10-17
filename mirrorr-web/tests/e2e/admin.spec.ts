import { autorun, expect, profile, session, source, test } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * Admin surface (plans: admin-ownership-and-access, element-access-and-bulk-perms).
 * The console ships as a second build whose entry is `admin.html`; the dev server
 * serves that file regardless of the surface flag, and the admin entry mounts the
 * same router with the administration section contributed and the access slot
 * provided. Its own path is not a route, so the spec steps through the not-found
 * link and the sidebar into the list it wants.
 */
async function openAdmin(page: Page): Promise<void> {
  await page.goto("/admin.html");
  await page.getByRole("link", { name: "Back to sessions" }).click();
}

async function openNav(page: Page, label: string): Promise<void> {
  await page.getByRole("link", { name: label, exact: true }).first().click();
}

async function openAdminSettings(page: Page): Promise<void> {
  await openAdmin(page);
  await openNav(page, "Settings");
  await expect(
    page.getByRole("heading", { level: 1, name: "Settings" }),
  ).toBeVisible();
}

function resourcePanel(page: Page) {
  return page.locator('section:has(> header > h2:text-is("Resource access"))');
}

function accessButton(page: Page) {
  return page.getByRole("button", { name: /^Access for / });
}

const USERS = [
  { id: 1, username: "kyros", role: "admin", display_name: "Kyros" },
  { id: 2, username: "alice", role: "user", display_name: "Alice" },
];

function sessionRow() {
  return resourceRow("session", 7, "F1 Weekend", 2);
}

function resourceRow(
  resourceType: string,
  id: number,
  label: string,
  viewerCount = 0,
  owner = "kyros",
) {
  return {
    resource_type: resourceType,
    id,
    label,
    owner,
    owner_missing:
      owner !== "" && !USERS.some((user) => user.username === owner),
    viewer_count: viewerCount,
    system: false,
  };
}

function recordingRow() {
  return {
    id: 3,
    user_friendly_name: "Speedcubing finals",
    snake_case_name: "speedcubing_finals",
    content_url: "https://example.test/content/speedcubing_3/recording.mp4",
    profile_name: "speedcubing",
    engine_name: "yt_dlp_piped",
    resolver_name: "daddylive",
    started_at: "2026-10-09 17:00:00",
    ended_at: "2026-10-09 18:00:00",
    duration_seconds: 3600,
    size_bytes: 123456789,
    created_at: "2026-10-09 18:00:00",
  };
}

test.describe("admin resource access", () => {
  test("lists resources and leaves system rows read-only", async ({
    page,
    api,
  }) => {
    api.data.users = USERS;
    api.data.resources = [
      sessionRow(),
      {
        resource_type: "engine",
        id: 1,
        label: "Streamlink",
        owner: "",
        owner_missing: false,
        viewer_count: 0,
        system: true,
      },
    ];

    await openAdminSettings(page);

    const panel = resourcePanel(page);
    await expect(panel.getByText("F1 Weekend", { exact: true })).toBeVisible();
    await expect(panel.getByText("kyros", { exact: true })).toBeVisible();
    await expect(panel.getByText("System", { exact: true })).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "Manage access for Streamlink" }),
    ).toHaveCount(0);
    await expect(
      panel.getByRole("button", { name: "Manage access for F1 Weekend" }),
    ).toBeVisible();
  });

  test("adds then removes a viewer, then reassigns the owner", async ({
    page,
    api,
  }) => {
    api.data.users = USERS;
    api.data.resources = [sessionRow()];

    await openAdminSettings(page);

    await resourcePanel(page)
      .getByRole("button", { name: "Manage access for F1 Weekend" })
      .click();

    const dialog = page.getByRole("dialog");
    const catalog = dialog.getByTestId("access-catalog");
    const lower = dialog.getByRole("group", {
      name: "Capabilities for the selected users and groups",
    });

    // Grant VIEW to Alice, then clear it — the last capability going clears the user outright.
    await catalog.getByRole("option", { name: /Alice/ }).click();
    await lower.getByRole("button", { name: "View access" }).click();
    await dialog.getByRole("button", { name: "Apply changes" }).click();
    await expect
      .poll(() =>
        api.callsTo("/shares/session/7").some((call) => call.method === "POST"),
      )
      .toBe(true);

    await lower.getByRole("button", { name: "View access" }).click();
    await dialog.getByRole("button", { name: "Apply changes" }).click();
    await expect
      .poll(() =>
        api
          .callsTo("/shares/session/7/alice")
          .some((call) => call.method === "DELETE"),
      )
      .toBe(true);

    // Then hand the crown over: into the owner row from the field, then crowned there.
    await dialog.getByRole("combobox", { name: "Add an owner" }).fill("Alice");
    await dialog
      .getByRole("listbox", { name: "Users and groups to own this item" })
      .getByRole("option", { name: /Alice/ })
      .click();
    await dialog.getByRole("button", { name: "Make Alice the owner" }).click();
    await dialog.getByRole("button", { name: "Apply changes" }).click();
    await expect
      .poll(() =>
        api
          .callsTo("/admin/resources/session/7/owner")
          .some(
            (call) =>
              call.method === "PUT" &&
              (call.body as { username?: string }).username === "alice",
          ),
      )
      .toBe(true);
  });

  test("crowns a group from its co-owner badge", async ({ page, api }) => {
    api.data.users = USERS;
    api.data.resources = [sessionRow()];
    api.data.groups = [
      {
        id: 9,
        name: "f1-team",
        display_name: "F1 team",
        system: false,
        member_count: 1,
        members: ["alice"],
      },
    ];

    await openAdminSettings(page);

    await resourcePanel(page)
      .getByRole("button", { name: "Manage access for F1 Weekend" })
      .click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: "Add an owner" }).fill("F1");
    await dialog
      .getByRole("listbox", { name: "Users and groups to own this item" })
      .getByRole("option", { name: /F1 team/ })
      .click();
    await dialog
      .getByRole("button", { name: "Make F1 team the owner" })
      .click();
    await dialog.getByRole("button", { name: "Apply changes" }).click();

    await expect
      .poll(() =>
        api
          .callsTo("/admin/resources/session/7/owner")
          .some(
            (call) =>
              call.method === "PUT" &&
              (call.body as { group_id?: number }).group_id === 9,
          ),
      )
      .toBe(true);
  });

  test("crowns a co-owner from its badge", async ({ page, api }) => {
    api.data.users = USERS;
    api.data.resources = [sessionRow()];
    api.data.ownerUsers = { "session:7": ["alice"] };

    await openAdminSettings(page);

    await resourcePanel(page)
      .getByRole("button", { name: "Manage access for F1 Weekend" })
      .click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Make Alice the owner" }).click();
    await dialog.getByRole("button", { name: "Apply changes" }).click();

    await expect
      .poll(() =>
        api
          .callsTo("/admin/resources/session/7/owner")
          .some(
            (call) =>
              call.method === "PUT" &&
              (call.body as { username?: string }).username === "alice",
          ),
      )
      .toBe(true);
  });

  test("suggests principals under the overrides search", async ({
    page,
    api,
  }) => {
    api.data.users = USERS;
    api.data.resources = [sessionRow()];

    await openAdminSettings(page);

    await resourcePanel(page)
      .getByRole("button", { name: "Manage access for F1 Weekend" })
      .click();

    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("combobox", { name: "Search users and groups" })
      .fill("ali");
    await dialog
      .getByRole("listbox", { name: "Matching users and groups" })
      .getByRole("option", { name: /Alice/ })
      .click();

    await expect(
      dialog
        .getByTestId("access-catalog")
        .getByRole("option", { name: /Alice/ }),
    ).toHaveAttribute("aria-selected", "true");
  });

  test("puts the access button on every owner-bearing list", async ({
    page,
    api,
  }) => {
    api.data.users = USERS;
    api.data.sessions = [session({ id: 7 })];
    api.data.autoruns = [autorun({ id: 5, user_friendly_name: "F1 Race" })];
    api.data.recordings = [recordingRow()];
    api.data.profiles = [profile()];
    api.data.sources = [source()];

    await openAdmin(page);
    await expect(accessButton(page).first()).toBeVisible();

    for (const label of ["Autoruns", "Recordings"]) {
      await openNav(page, label);
      await expect(accessButton(page).first()).toBeVisible();
    }

    // Presets paints both panels at once — profiles above, saved sources below.
    await openNav(page, "Presets");
    await expect(
      page.getByRole("button", { name: "Access for F1 Weekend" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Access for Sky Sports" }).first(),
    ).toBeVisible();
  });

  test("edits an item's access from its own button", async ({ page, api }) => {
    api.data.users = USERS;
    api.data.autoruns = [autorun({ id: 5, user_friendly_name: "F1 Race" })];
    api.data.resources = [resourceRow("autorun", 5, "F1 Race")];

    await openAdmin(page);
    await openNav(page, "Autoruns");

    await page.getByRole("button", { name: "Access for F1 Race" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Access · F1 Race")).toBeVisible();
    await expect(dialog.getByText("Autorun · #5")).toBeVisible();

    const catalog = dialog.getByTestId("access-catalog");
    const lower = dialog.getByRole("group", {
      name: "Capabilities for the selected users and groups",
    });

    // Tap Alice's card, then the VIEW chip, then apply — a POST, never a bare view list.
    await catalog.getByRole("option", { name: /Alice/ }).click();
    await lower.getByRole("button", { name: "View access" }).click();
    await dialog.getByRole("button", { name: "Apply changes" }).click();
    await expect
      .poll(() =>
        api.callsTo("/shares/autorun/5").some((call) => call.method === "POST"),
      )
      .toBe(true);
    await expect(dialog.getByText("Up to date")).toBeVisible();

    // Clearing VIEW clears the user's last capability → DELETE.
    await lower.getByRole("button", { name: "View access" }).click();
    await dialog.getByRole("button", { name: "Apply changes" }).click();
    await expect
      .poll(() =>
        api
          .callsTo("/shares/autorun/5/alice")
          .some((call) => call.method === "DELETE"),
      )
      .toBe(true);

    await dialog.getByRole("combobox", { name: "Add an owner" }).fill("Alice");
    await dialog
      .getByRole("listbox", { name: "Users and groups to own this item" })
      .getByRole("option", { name: /Alice/ })
      .click();
    await dialog.getByRole("button", { name: "Make Alice the owner" }).click();
    await dialog.getByRole("button", { name: "Apply changes" }).click();
    await expect
      .poll(() =>
        api
          .callsTo("/admin/resources/autorun/5/owner")
          .some((call) => call.method === "PUT"),
      )
      .toBe(true);
  });

  test("drag-selects the cards it sweeps and auto-scrolls at the edge", async ({
    page,
    api,
  }) => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      id: index + 2,
      username: `viewer${index + 1}`,
      role: "user",
      display_name: `Viewer ${index + 1}`,
    }));
    api.data.users = [USERS[0], ...many];
    api.data.sessions = [session({ id: 7 })];
    api.data.resources = [resourceRow("session", 7, "F1 Weekend")];

    await openAdmin(page);
    await accessButton(page).first().click();

    const dialog = page.getByRole("dialog");
    const catalog = dialog.getByTestId("access-catalog");
    const box = await catalog.boundingBox();
    if (box === null) throw new Error("catalog has no box");

    await page.mouse.move(box.x + 6, box.y + 24);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 6, box.y + 24, { steps: 8 });
    // Dwell near the bottom edge: the marquee should auto-scroll the catalog.
    await page.mouse.move(box.x + box.width - 6, box.y + box.height - 6, {
      steps: 8,
    });
    await page.waitForTimeout(400);

    const scrollTop = await catalog.evaluate(
      (element) => (element as unknown as { scrollTop: number }).scrollTop,
    );
    const pressed = await dialog
      .locator(
        '[data-testid="access-catalog"] [role="option"][aria-selected="true"]',
      )
      .count();
    await page.mouse.up();

    expect(pressed).toBeGreaterThanOrEqual(2);
    expect(scrollTop).toBeGreaterThan(0);
    // The marquee's pointerup must not land as a click on a card.
    await expect(page).toHaveURL(/\/sessions$/);
  });

  test("a click inside the access panel does not open the session detail", async ({
    page,
    api,
  }) => {
    api.data.users = USERS;
    api.data.sessions = [session({ id: 7 })];
    api.data.resources = [resourceRow("session", 7, "F1 Weekend")];

    await openAdmin(page);

    const trigger = accessButton(page).first();
    await trigger.click();

    const dialog = page.getByRole("dialog");
    // The owner row is panel chrome, not a control — the click that used to navigate.
    await dialog.getByText("Kyros").first().click();

    await expect(page).toHaveURL(/\/sessions$/);
    await expect(dialog.getByTestId("access-catalog")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("bulk access uses the shared editor and warns before overriding an item's own access", async ({
    page,
    api,
  }) => {
    api.data.users = USERS;
    api.data.autoruns = [
      autorun({ id: 5, user_friendly_name: "F1 Race" }),
      autorun({ id: 6, user_friendly_name: "F2 Sprint" }),
    ];
    api.data.resources = [
      resourceRow("autorun", 5, "F1 Race", 0, "ghost"),
      resourceRow("autorun", 6, "F2 Sprint"),
    ];

    await openAdmin(page);
    await openNav(page, "Autoruns");

    await page.getByRole("checkbox", { name: "Select F1 Race" }).check();
    await page.getByRole("checkbox", { name: "Select F2 Sprint" }).check();
    await page.getByRole("button", { name: "Access", exact: true }).click();

    await expect(page.getByText("Access on 2 item(s)")).toBeVisible();
    await expect(page.getByText("1 already overridden")).toBeVisible();
    await expect(page.getByText("Owner account missing")).toBeVisible();

    await expect(page.getByText("Left as it is")).toBeVisible();

    const bulk = page.getByRole("dialog");
    await bulk.getByRole("combobox", { name: "Add an owner" }).fill("Alice");
    await bulk
      .getByRole("listbox", { name: "Users and groups to own this item" })
      .getByRole("option", { name: /Alice/ })
      .click();
    await bulk.getByRole("button", { name: "Make Alice the owner" }).click();
    await page.getByRole("button", { name: "Apply to 2" }).click();

    await expect(page.getByText("Override 1 item(s)?")).toBeVisible();
    await expect(page.getByRole("dialog").getByText("F1 Race")).toBeVisible();
    await expect(
      page.getByRole("dialog").getByText("ghost (missing)"),
    ).toBeVisible();
    await expect(page.getByRole("dialog").getByText("F2 Sprint")).toHaveCount(
      0,
    );

    await page.getByRole("button", { name: "Override and apply" }).click();
    await expect
      .poll(() =>
        api
          .callsTo("/admin/resources/autorun/5/owner")
          .some((call) => call.method === "PUT"),
      )
      .toBe(true);
    await expect
      .poll(() =>
        api
          .callsTo("/admin/resources/autorun/6/owner")
          .some((call) => call.method === "PUT"),
      )
      .toBe(true);
  });

  test("bulk access grants a capability to a group from the shared editor", async ({
    page,
    api,
  }) => {
    api.data.users = USERS;
    api.data.groups = [
      {
        id: 9,
        name: "f1-team",
        display_name: "F1 team",
        system: false,
        members: ["alice"],
      },
    ];
    api.data.sessions = [session({ id: 7 })];
    api.data.resources = [resourceRow("session", 7, "F1 Weekend")];

    await openAdmin(page);

    await page.getByRole("checkbox", { name: "Select session #7" }).check();
    await page.getByRole("button", { name: "Access", exact: true }).click();

    const dialog = page.getByRole("dialog");
    const lower = dialog.getByRole("group", {
      name: "Capabilities for the selected users and groups",
    });

    await dialog
      .getByTestId("access-catalog")
      .getByRole("option", { name: /F1 team/ })
      .click();
    await lower.getByRole("button", { name: /Operate/ }).click();
    await expect(dialog.getByText("1 change(s) planned")).toBeVisible();

    await dialog.getByRole("button", { name: "Apply to 1" }).click();
    await expect
      .poll(() =>
        api
          .callsTo("/shares/session/7/group/9")
          .some((call) => call.method === "POST"),
      )
      .toBe(true);
    expect(api.callsTo("/shares/session/7/group/9").at(-1)?.body).toMatchObject(
      {
        capabilities: ["VIEW", "OPERATE"],
      },
    );
  });

  test("keeps the catalog and the capability chip row inside the dialog at 375px", async ({
    page,
    api,
  }) => {
    api.data.users = [
      { id: 1, username: "kyros", role: "admin", display_name: "Kyros" },
      { id: 2, username: "alice", role: "user", display_name: "Alice" },
      { id: 3, username: "bob", role: "user", display_name: "Bob" },
      { id: 4, username: "carol", role: "user", display_name: "Carol" },
    ];
    api.data.sessions = [session({ id: 7 })];
    api.data.resources = [resourceRow("session", 7, "F1 Weekend")];

    await openAdmin(page);
    await accessButton(page).first().click();

    const dialog = page.getByRole("dialog");
    const catalog = dialog.getByTestId("access-catalog");
    const chipRow = dialog.getByRole("group", {
      name: "Capabilities for the selected users and groups",
    });

    // The chip row acts on what the catalog holds: a tap marks the card, the
    // chip then reports and flips that capability on the selection.
    await catalog.getByRole("option", { name: /Alice/ }).click();
    await expect(
      catalog.getByRole("option", { name: /Alice/ }),
    ).toHaveAttribute("aria-selected", "true");
    await chipRow.getByRole("button", { name: "Operate" }).click();
    await expect(
      chipRow.getByRole("button", { name: "Operate" }),
    ).toHaveAttribute("aria-pressed", "true");

    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(150);

    // The chip row wraps rather than scrolls at 375px, and the dialog must still
    // fit without its body scrolling or clipping a chip horizontally.
    const fit = await dialog.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const group = node.querySelector(
        '[role="group"][aria-label="Capabilities for the selected users and groups"]',
      );
      const edges =
        group === null
          ? []
          : [...group.querySelectorAll("button")].map((chip) =>
              chip.getBoundingClientRect(),
            );
      const body = node.querySelector(":scope > div");
      return {
        top: box.top,
        bottom: box.bottom,
        chips: edges.length,
        lines: new Set(edges.map((edge) => Math.round(edge.top))).size,
        maxRight: Math.max(...edges.map((edge) => edge.right)),
        groupRight: group === null ? 0 : group.getBoundingClientRect().right,
        bodyScrolls:
          body === null ? null : body.scrollHeight > body.clientHeight + 1,
      };
    });

    expect(fit.top).toBeGreaterThanOrEqual(0);
    expect(fit.bottom).toBeLessThanOrEqual(812);
    expect(fit.bodyScrolls).toBe(false);
    expect(fit.chips).toBeGreaterThan(0);
    expect(fit.lines).toBeLessThanOrEqual(2);
    expect(fit.maxRight).toBeLessThanOrEqual(fit.groupRight + 1);
  });

  test("offers only the capabilities an autorun enforces", async ({
    page,
    api,
  }) => {
    api.data.users = USERS;
    api.data.autoruns = [autorun({ id: 5, user_friendly_name: "F1 Race" })];
    api.data.resources = [resourceRow("autorun", 5, "F1 Race")];

    await openAdmin(page);
    await openNav(page, "Autoruns");
    await page.getByRole("button", { name: "Access for F1 Race" }).click();

    const dialog = page.getByRole("dialog");
    const lower = dialog.getByRole("group", {
      name: "Capabilities for the selected users and groups",
    });

    await expect(lower.getByRole("button", { name: "Edit" })).toBeVisible();
    await expect(lower.getByRole("button", { name: "Export" })).toBeVisible();
    // An autorun has no control route, so OPERATE would be an inert control.
    await expect(lower.getByRole("button", { name: "Operate" })).toHaveCount(0);
  });

  test("keeps an inapplicable existing grant visible and removable", async ({
    page,
    api,
  }) => {
    api.data.users = USERS;
    api.data.autoruns = [autorun({ id: 5, user_friendly_name: "F1 Race" })];
    api.data.resources = [resourceRow("autorun", 5, "F1 Race")];
    // An OPERATE grant on an autorun predates the type filter: no chip offers
    // it, so the panel must still surface it or it could never be cleared.
    api.data.resourceGrants = {
      "autorun:5": [{ username: "alice", capabilities: ["VIEW", "OPERATE"] }],
    };

    await openAdmin(page);
    await openNav(page, "Autoruns");
    await page.getByRole("button", { name: "Access for F1 Race" }).click();

    const dialog = page.getByRole("dialog");
    const catalog = dialog.getByTestId("access-catalog");
    const lower = dialog.getByRole("group", {
      name: "Capabilities for the selected users and groups",
    });

    const retired = lower.getByRole("button", { name: "Operate" });
    await expect(retired).toBeVisible();

    await catalog.getByRole("option", { name: /Alice/ }).click();
    await retired.click();
    await dialog.getByRole("button", { name: "Apply changes" }).click();

    // VIEW survives, so the replace-set POST carries the reduced set — proof the
    // OPERATE grant went away through a control the type filter does not offer.
    await expect
      .poll(() =>
        api.callsTo("/shares/autorun/5").some((call) => call.method === "POST"),
      )
      .toBe(true);
    const posted = api
      .callsTo("/shares/autorun/5")
      .filter((call) => call.method === "POST")
      .at(-1);
    expect(posted?.body).toEqual({ username: "alice", capabilities: ["VIEW"] });
  });

  function groupsPanel(page: Page) {
    return page.locator('section:has(> header > h2:text-is("Groups"))');
  }

  const GROUPS = [
    {
      id: 1,
      name: "everyone",
      display_name: "Everyone",
      system: true,
      member_count: 2,
      members: ["kyros", "alice"],
    },
    {
      id: 9,
      name: "f1-team",
      display_name: "F1 team",
      system: false,
      member_count: 1,
      members: ["alice"],
    },
  ];

  test("lists groups, seals the reserved one and creates a group", async ({
    page,
    api,
  }) => {
    api.data.users = USERS;
    api.data.groups = GROUPS;

    await openAdminSettings(page);

    const panel = groupsPanel(page);
    await expect(panel.getByText("F1 team", { exact: true })).toBeVisible();
    await expect(panel.getByText("@f1-team", { exact: true })).toBeVisible();
    await expect(
      panel
        .getByRole("row", { name: /f1-team/ })
        .getByRole("cell", { name: "1", exact: true }),
    ).toBeVisible();

    // The reserved group is always listed and never editable: its membership is
    // every account, including the ones that do not exist yet.
    const sealed = panel.getByRole("row", { name: /@everyone/ });
    await expect(sealed.getByText("@everyone", { exact: true })).toBeVisible();
    await expect(
      sealed.getByText(
        "Every account, including future ones — membership is implicit.",
      ),
    ).toBeVisible();
    await expect(
      sealed.getByRole("cell", { name: "Everyone", exact: true }),
    ).toBeVisible();
    await expect(panel.getByRole("button", { name: "Members" })).toHaveCount(1);
    await expect(
      panel.getByRole("button", { name: "Edit everyone" }),
    ).toHaveCount(0);
    await expect(
      panel.getByRole("button", { name: "Delete everyone" }),
    ).toHaveCount(0);

    await panel.getByRole("button", { name: "Add group" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/^Name/).fill("editors");
    await dialog.getByLabel(/^Display/).fill("Editors");
    await dialog.getByRole("button", { name: "Create group" }).click();

    await expect
      .poll(() => api.callsTo("/groups").some((call) => call.method === "POST"))
      .toBe(true);
    const posted = api
      .callsTo("/groups")
      .filter((call) => call.method === "POST")
      .at(-1);
    expect(posted?.body).toEqual({ name: "editors", display_name: "Editors" });
  });

  test("sets a group's members, renames it and deletes it", async ({
    page,
    api,
  }) => {
    api.data.users = USERS;
    api.data.groups = GROUPS;

    await openAdminSettings(page);
    const panel = groupsPanel(page);

    await panel.getByRole("button", { name: "Members" }).click();
    const members = page.getByRole("dialog");
    await expect(members.getByText("Members · f1-team")).toBeVisible();
    await members.getByRole("checkbox", { name: /Kyros/ }).click();
    await members.getByRole("button", { name: "Save members" }).click();

    await expect
      .poll(() =>
        api.callsTo("/groups/9/members").some((call) => call.method === "PUT"),
      )
      .toBe(true);
    const put = api
      .callsTo("/groups/9/members")
      .filter((call) => call.method === "PUT")
      .at(-1);
    expect(put?.body).toEqual({ usernames: ["alice", "kyros"] });

    await panel.getByRole("button", { name: "Edit f1-team" }).click();
    const edit = page.getByRole("dialog");
    await expect(edit.getByText("Edit f1-team")).toBeVisible();
    await edit.getByLabel(/^Display/).fill("F1 team 2026");
    await edit.getByRole("button", { name: "Save" }).click();

    await expect
      .poll(() =>
        api.callsTo("/groups/9").some((call) => call.method === "PATCH"),
      )
      .toBe(true);
    const patch = api
      .callsTo("/groups/9")
      .filter((call) => call.method === "PATCH")
      .at(-1);
    expect(patch?.body).toMatchObject({ display_name: "F1 team 2026" });

    await panel.getByRole("button", { name: "Delete f1-team" }).click();
    const confirm = page.getByRole("dialog");
    await expect(confirm.getByText("Delete group")).toBeVisible();
    await confirm.getByRole("button", { name: "Delete", exact: true }).click();

    await expect
      .poll(() =>
        api.callsTo("/groups/9").some((call) => call.method === "DELETE"),
      )
      .toBe(true);
  });

  test("grants a capability to a group and adds an owner group with an everyone warning", async ({
    page,
    api,
  }) => {
    api.data.users = USERS;
    api.data.resources = [sessionRow()];
    api.data.groups = GROUPS;

    await openAdminSettings(page);
    await resourcePanel(page)
      .getByRole("button", { name: "Manage access for F1 Weekend" })
      .click();

    const dialog = page.getByRole("dialog");
    const catalog = dialog.getByTestId("access-catalog");
    const lower = dialog.getByRole("group", {
      name: "Capabilities for the selected users and groups",
    });

    // The one catalog carries the groups too, so a group grants the same way.
    await expect(
      catalog.getByRole("option", { name: /F1 team/ }),
    ).toBeVisible();
    await expect(
      catalog.getByText("every account, including future ones"),
    ).toBeVisible();
    await catalog.getByRole("option", { name: /F1 team/ }).click();
    await lower.getByRole("button", { name: "View access" }).click();
    await dialog.getByRole("button", { name: "Apply changes" }).click();

    await expect
      .poll(() =>
        api
          .callsTo("/shares/session/7/group/9")
          .some((call) => call.method === "POST"),
      )
      .toBe(true);
    const granted = api
      .callsTo("/shares/session/7/group/9")
      .filter((call) => call.method === "POST")
      .at(-1);
    expect(granted?.body).toEqual({ capabilities: ["VIEW"] });

    // Ownership is additive and `everyone` may be chosen — the panel says plainly
    // what that means before anything is applied.
    const ownerField = dialog.getByRole("combobox", { name: "Add an owner" });
    const ownerOptions = dialog.getByRole("listbox", {
      name: "Users and groups to own this item",
    });
    await ownerField.fill("F1");
    await ownerOptions.getByRole("option", { name: /F1 team/ }).click();
    await ownerField.fill("everyone");
    await ownerOptions.getByRole("option", { name: /Everyone/ }).click();
    await expect(
      dialog
        .getByRole("alert")
        .filter({ hasText: "every account gets full control of this item" }),
    ).toBeVisible();

    await dialog.getByRole("button", { name: "Apply changes" }).click();
    await expect
      .poll(() =>
        api
          .callsTo("/shares/session/7/owner-group/9")
          .some((call) => call.method === "PUT"),
      )
      .toBe(true);
    await expect
      .poll(() =>
        api
          .callsTo("/shares/session/7/owner-group/1")
          .some((call) => call.method === "PUT"),
      )
      .toBe(true);

    await dialog
      .getByRole("button", { name: "Remove owner group Everyone" })
      .click();
    await dialog.getByRole("button", { name: "Apply changes" }).click();
    await expect
      .poll(() =>
        api
          .callsTo("/shares/session/7/owner-group/1")
          .some((call) => call.method === "DELETE"),
      )
      .toBe(true);

    await ownerField.fill("Alice");
    await ownerOptions.getByRole("option", { name: /Alice/ }).click();
    await dialog.getByRole("button", { name: "Apply changes" }).click();
    await expect
      .poll(() =>
        api
          .callsTo("/shares/session/7/owner-user/alice")
          .some((call) => call.method === "PUT"),
      )
      .toBe(true);

    await dialog.getByRole("button", { name: "Remove owner alice" }).click();
    await dialog.getByRole("button", { name: "Apply changes" }).click();
    await expect
      .poll(() =>
        api
          .callsTo("/shares/session/7/owner-user/alice")
          .some((call) => call.method === "DELETE"),
      )
      .toBe(true);

    await ownerField.fill("ali");
    await expect(ownerOptions).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect(ownerField).toHaveValue("");
    await expect(ownerField).not.toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});
