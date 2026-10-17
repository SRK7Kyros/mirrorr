import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  applyPlans,
  emptyGrants,
  emptyGroupGrants,
  planItem,
  type AccessTarget,
  type Crown,
  type ItemAccess,
} from "@/api/domain/access-plan";
import { CAPABILITIES, type Capability } from "@/api/schemas/privileged";
import type { User } from "@/api/schemas/user";
import {
  type AccessGroup,
  type GroupDraftTarget,
  holdsCapability,
  ResourceAccessFields,
} from "./resource-access";

// The planner fans out over the endpoint module (importing the barrel from a
// domain module would close a cycle), so it needs its own double. Every test
// that reaches the wire asserts on these calls, not just on the rendered state.
const endpoints = vi.hoisted(() => ({
  setResourceOwner: vi.fn(),
  setResourceGrants: vi.fn(),
  revokeResourceUser: vi.fn(),
}));
vi.mock("@/api/endpoints/access", () => endpoints);

const USERS: readonly User[] = [
  { id: 1, username: "kyros", role: "admin", display_name: "Kyros" },
  { id: 2, username: "alice", role: "user", display_name: "Alice" },
  { id: 3, username: "bob", role: "user", display_name: "Bob" },
  { id: 4, username: "carol", role: "user", display_name: "Carol" },
];

const USERNAMES = USERS.map((user) => user.username);

const GROUPS: readonly AccessGroup[] = [
  { id: 1, name: "everyone", display_name: "Everyone", system: true },
  {
    id: 2,
    name: "editors",
    display_name: "Editors",
    system: false,
    member_count: 3,
  },
  {
    id: 3,
    name: "ops",
    display_name: "Operations",
    system: false,
    member_count: 1,
  },
];

function userCrown(username: string): Crown {
  return { kind: "user", username };
}

function groupCrown(groupId: number): Crown {
  return { kind: "group", groupId };
}

/** A full grant record — every capability present, exactly as `emptyGrants` guarantees. */
function access(
  overrides: Partial<Record<Capability, readonly string[]>> & {
    readonly crown?: Crown;
    readonly ownerMissing?: boolean;
    readonly groupGrants?: Partial<Record<Capability, readonly number[]>>;
    readonly ownerUsers?: readonly string[];
    readonly ownerGroups?: readonly number[];
  } = {},
): ItemAccess {
  const {
    crown = userCrown("kyros"),
    ownerMissing = false,
    groupGrants = {},
    ownerUsers = [],
    ownerGroups = [],
    ...grants
  } = overrides;
  return {
    crown,
    ownerMissing,
    grants: { ...emptyGrants(), ...grants },
    groupGrants: { ...emptyGroupGrants(), ...groupGrants },
    ownerUsers,
    ownerGroups,
  };
}

function row(itemAccess: ItemAccess) {
  return {
    resourceType: "session",
    id: 1,
    label: "F1 Weekend",
    access: itemAccess,
  };
}

function catalog(): HTMLElement {
  return screen.getByTestId("access-catalog");
}

function setGroup(): HTMLElement {
  return screen.getByRole("group", {
    name: "Capabilities for the selected users and groups",
  });
}

function setChip(label: string): HTMLButtonElement {
  return within(setGroup()).getByRole("button", {
    name: label,
  }) as HTMLButtonElement;
}

function card(name: string): HTMLElement {
  return within(catalog()).getByRole("option", { name: new RegExp(name) });
}

/** The owner field's floating suggestions — the catalog below holds options too. */
function ownerList(): HTMLElement {
  return screen.getByRole("listbox", {
    name: "Users and groups to own this item",
  });
}

function applyButton(): HTMLButtonElement {
  return screen.getByRole("button", {
    name: "Apply changes",
  }) as HTMLButtonElement;
}

describe("holdsCapability", () => {
  it("reads VIEW from any held capability but the rest literally", () => {
    const grants = { ...emptyGrants(), OPERATE: ["bob"] };
    expect(holdsCapability(grants, "VIEW", "bob")).toBe(true);
    expect(holdsCapability(grants, "OPERATE", "bob")).toBe(true);
    expect(holdsCapability(grants, "EDIT", "bob")).toBe(false);
    expect(holdsCapability(grants, "VIEW", "alice")).toBe(false);
  });
});

describe("ResourceAccessFields", () => {
  it("renders the owner row, one users-and-groups catalog and the chip row, with no per-section prose", () => {
    render(
      <ResourceAccessFields
        resourceType="session"
        access={access()}
        users={USERS}
        groups={GROUPS}
        onApply={vi.fn()}
      />,
    );

    expect([...CAPABILITIES]).toEqual([
      "VIEW",
      "OPERATE",
      "EDIT",
      "DELETE",
      "SHARE",
      "EXPORT",
    ]);
    expect(screen.getByText("Kyros")).toBeTruthy();
    const badge = screen.getByTestId("owner-crown");
    expect(badge).toBeTruthy();
    expect(badge.className).toContain("bg-warning-dim");
    expect(catalog()).toBeTruthy();
    // One list carries both kinds: no principal switch and no capability filter.
    expect(card("Bob")).toBeTruthy();
    expect(card("Editors")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Principal" })).toBeNull();
    expect(
      screen.queryByRole("group", { name: "Filter by capability" }),
    ).toBeNull();
    const labels = ["View access", "Operate", "Edit", "Delete", "Share"];
    for (const label of labels) expect(setChip(label)).toBeTruthy();
    // A session has no export route, so the type filter does not offer EXPORT.
    expect(
      within(setGroup()).queryByRole("button", { name: "Export" }),
    ).toBeNull();
    expect(screen.queryByText("Only the owner can see this item.")).toBeNull();
    expect(screen.getByText("Up to date")).toBeTruthy();
    // The two halves are labelled and hinted: owners hold everything, overrides narrow it.
    expect(screen.getByText("Ownership")).toBeTruthy();
    expect(
      screen.getByText("Owners get every permission on this item."),
    ).toBeTruthy();
    expect(screen.getByText("Permission overrides")).toBeTruthy();
    expect(
      screen.getByText(
        "Overrides are more specific — they grant only the capabilities you pick.",
      ),
    ).toBeTruthy();
  });

  it("keeps Apply disabled until the draft is dirty", () => {
    render(
      <ResourceAccessFields
        resourceType="session"
        access={access()}
        users={USERS}
        groups={GROUPS}
        onApply={vi.fn()}
      />,
    );
    expect(applyButton().disabled).toBe(true);

    fireEvent.click(card("Bob"));
    fireEvent.click(setChip("Operate"));

    expect(applyButton().disabled).toBe(false);
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });

  it("removes an owner with Backspace from its badge and leaves focus in the field", () => {
    render(
      <ResourceAccessFields
        resourceType="session"
        access={access({ ownerUsers: ["bob"] })}
        users={USERS}
        groups={GROUPS}
        onApply={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Remove owner bob" }).className,
    ).toContain("tab-skip");

    const badge = screen.getByRole("button", { name: "Make Bob the owner" });
    badge.focus();
    fireEvent.keyDown(badge, { key: "Backspace" });

    expect(
      screen.queryByRole("button", { name: "Make Bob the owner" }),
    ).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("combobox", { name: "Add an owner" }),
    );
  });

  it("keeps the crown badge and the co-owner badges in one row, with no transfer mode", () => {
    render(
      <ResourceAccessFields
        resourceType="session"
        access={access({ ownerUsers: ["bob"], ownerGroups: [2] })}
        users={USERS}
        groups={GROUPS}
        onApply={vi.fn()}
      />,
    );

    const crown = screen.getByTestId("owner-crown");
    expect(crown.className).toContain("bg-warning-dim");
    expect(crown.textContent).toContain("Kyros");
    expect(
      screen.getByRole("button", { name: "Make Bob the owner" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Make Editors the owner" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Remove owner bob" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Remove owner group Editors" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Change the owner" }),
    ).toBeNull();
    expect(screen.queryByText("Pick the new owner")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Add an owner" })).toBeTruthy();
    expect(
      screen.getByRole("group", {
        name: "Capabilities for the selected users and groups",
      }),
    ).toBeTruthy();
  });

  it("crowns a co-owner group from its badge", () => {
    const onApply = vi.fn();
    render(
      <ResourceAccessFields
        resourceType="session"
        access={access({ ownerGroups: [2] })}
        users={USERS}
        groups={GROUPS}
        onApply={onApply}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Make Editors the owner" }),
    );
    fireEvent.click(applyButton());

    const target = onApply.mock.calls[0][0] as AccessTarget;
    expect(target.crown).toEqual(groupCrown(2));
  });

  it("implies VIEW and issues one request per resulting capability", async () => {
    const base = access();
    const onApply = vi.fn();
    render(
      <ResourceAccessFields
        resourceType="session"
        access={base}
        users={USERS}
        groups={GROUPS}
        onApply={onApply}
      />,
    );

    fireEvent.click(card("Bob"));
    fireEvent.click(setChip("Operate"));

    // Drafting alone reaches no wire — a control that only looks like it grants fails here.
    expect(endpoints.setResourceGrants).not.toHaveBeenCalled();

    fireEvent.click(applyButton());
    expect(onApply).toHaveBeenCalledTimes(1);
    const target = onApply.mock.calls[0][0] as AccessTarget;

    const plan = planItem(row(base), target, USERNAMES);
    expect(plan.ops).toEqual([
      { kind: "grant", capability: "VIEW", username: "bob" },
      { kind: "grant", capability: "OPERATE", username: "bob" },
    ]);

    await applyPlans([plan]);
    expect(endpoints.setResourceGrants).toHaveBeenCalledTimes(2);
    expect(endpoints.setResourceGrants).toHaveBeenNthCalledWith(
      1,
      "session",
      1,
      "bob",
      ["VIEW", "OPERATE"],
    );
    expect(endpoints.setResourceGrants).toHaveBeenNthCalledWith(
      2,
      "session",
      1,
      "bob",
      ["VIEW", "OPERATE"],
    );
    expect(endpoints.revokeResourceUser).not.toHaveBeenCalled();
  });

  it("clears every capability for the user when VIEW is unticked", async () => {
    const base = access({ VIEW: ["bob"], OPERATE: ["bob"], EDIT: ["bob"] });
    const onApply = vi.fn();
    render(
      <ResourceAccessFields
        resourceType="session"
        access={base}
        users={USERS}
        groups={GROUPS}
        onApply={onApply}
      />,
    );

    fireEvent.click(card("Bob"));
    expect(setChip("View access").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(setChip("View access"));
    expect(
      screen.getByText(
        "Clearing View access also clears every other capability.",
      ),
    ).toBeTruthy();

    fireEvent.click(applyButton());
    const target = onApply.mock.calls[0][0] as AccessTarget;
    expect(target.grants?.VIEW).toEqual([]);
    expect(target.grants?.OPERATE).toEqual([]);
    expect(target.grants?.EDIT).toEqual([]);

    const plan = planItem(row(base), target, USERNAMES);
    expect(plan.ops).toEqual([
      { kind: "revoke", capability: "VIEW", username: "bob" },
      { kind: "revoke", capability: "OPERATE", username: "bob" },
      { kind: "revoke", capability: "EDIT", username: "bob" },
    ]);

    await applyPlans([plan]);
    expect(endpoints.revokeResourceUser).toHaveBeenCalledWith(
      "session",
      1,
      "bob",
    );
    expect(endpoints.setResourceGrants).not.toHaveBeenCalled();
  });

  it("shows a partial lower chip when only some selected users hold the capability", () => {
    const base = access({ VIEW: ["bob"], OPERATE: ["bob"] });
    const onApply = vi.fn();
    render(
      <ResourceAccessFields
        resourceType="session"
        access={base}
        users={USERS}
        groups={GROUPS}
        onApply={onApply}
      />,
    );

    expect(setChip("Operate").getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));

    expect(setChip("Operate").getAttribute("aria-pressed")).toBe("mixed");
    fireEvent.click(setChip("Operate"));
    expect(setChip("Operate").getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(applyButton());
    const target = onApply.mock.calls[0][0] as AccessTarget;
    expect([...(target.grants?.OPERATE ?? [])].sort()).toEqual([
      "alice",
      "bob",
      "carol",
    ]);
  });

  it("selects every shown card and clears the selection", () => {
    render(
      <ResourceAccessFields
        resourceType="session"
        access={access()}
        users={USERS}
        groups={GROUPS}
        onApply={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    // Three users and three groups — the one list takes both.
    expect(
      within(catalog()).getAllByRole("option", { selected: true }),
    ).toHaveLength(6);

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(
      within(catalog()).queryAllByRole("option", { selected: true }),
    ).toHaveLength(0);
  });

  it("reloads on a changed access prop and preserves the draft on an unchanged one", () => {
    const base = access();
    const { rerender } = render(
      <ResourceAccessFields
        resourceType="session"
        access={base}
        users={USERS}
        groups={GROUPS}
        onApply={vi.fn()}
      />,
    );

    fireEvent.click(card("Bob"));
    fireEvent.click(setChip("Operate"));
    expect(screen.getByText("Unsaved changes")).toBeTruthy();

    // Same value → same signature → the in-flight edit survives.
    rerender(
      <ResourceAccessFields
        resourceType="session"
        access={base}
        users={USERS}
        groups={GROUPS}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByText("Unsaved changes")).toBeTruthy();

    // Different value → the draft reloads from the server state.
    rerender(
      <ResourceAccessFields
        resourceType="session"
        access={access({ VIEW: ["alice"] })}
        users={USERS}
        groups={GROUPS}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByText("Up to date")).toBeTruthy();
    expect(applyButton().disabled).toBe(true);
    // The draft reloaded from the server: Alice holds VIEW, Bob does not. The
    // card selection outlives the reload, so it is cleared between the probes.
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.click(card("Alice"));
    expect(setChip("View access").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.click(card("Bob"));
    expect(setChip("View access").getAttribute("aria-pressed")).toBe("false");
  });

  it("disables Apply, the cards and the chip rows while busy", () => {
    render(
      <ResourceAccessFields
        resourceType="session"
        access={access({ VIEW: ["bob"] })}
        users={USERS}
        busy
        groups={GROUPS}
        onApply={vi.fn()}
      />,
    );

    // The Spinner contributes "Loading" to the button's accessible name, so
    // locate the Apply control by its label span instead of the composed name.
    const applyControl = screen.getByText("Apply changes").closest("button");
    expect(applyControl).not.toBeNull();
    expect((applyControl as HTMLButtonElement).disabled).toBe(true);
    expect(setChip("Operate").disabled).toBe(true);
    expect(card("Bob").getAttribute("aria-disabled")).toBe("true");
  });

  it("carries all six capability keys and grants onto an otherwise-empty capability", () => {
    const base = access();
    expect(Object.keys(base.grants).sort()).toEqual([...CAPABILITIES].sort());

    const onApply = vi.fn();
    render(
      <ResourceAccessFields
        resourceType="session"
        access={base}
        users={USERS}
        groups={GROUPS}
        onApply={onApply}
      />,
    );

    fireEvent.click(card("Bob"));
    fireEvent.click(setChip("Delete"));
    fireEvent.click(applyButton());

    const target = onApply.mock.calls[0][0] as AccessTarget;
    expect(target.grants?.DELETE).toEqual(["bob"]);
    expect(target.grants?.VIEW).toEqual(["bob"]);
    for (const capability of CAPABILITIES) {
      if (capability !== "DELETE" && capability !== "VIEW")
        expect(target.grants?.[capability]).toEqual([]);
    }
  });

  it("offers only the capabilities the item type enforces", () => {
    render(
      <ResourceAccessFields
        resourceType="autorun"
        access={access()}
        users={USERS}
        groups={GROUPS}
        onApply={vi.fn()}
      />,
    );

    for (const label of ["View access", "Edit", "Delete", "Share", "Export"]) {
      expect(setChip(label)).toBeTruthy();
    }
    // An autorun has no control route, so OPERATE would be an inert control.
    expect(
      within(setGroup()).queryByRole("button", { name: "Operate" }),
    ).toBeNull();
  });

  it("keeps a granted capability the type no longer offers clearable", () => {
    const base = access({ VIEW: ["bob"], OPERATE: ["bob"] });
    const onApply = vi.fn();
    render(
      <ResourceAccessFields
        resourceType="autorun"
        access={base}
        users={USERS}
        groups={GROUPS}
        onApply={onApply}
      />,
    );

    // OPERATE is not offered for autoruns, but Bob holds it — the chip must
    // still exist so the pre-existing grant can be removed.
    const retired = setChip("Operate");
    expect(retired.getAttribute("title")).toBeTruthy();

    fireEvent.click(card("Bob"));
    fireEvent.click(retired);
    fireEvent.click(applyButton());

    const target = onApply.mock.calls[0][0] as AccessTarget;
    expect(target.grants?.OPERATE).toEqual([]);
    expect(target.grants?.VIEW).toEqual(["bob"]);
  });

  it("shows the same chip row for a group selection as for a user one", () => {
    render(
      <ResourceAccessFields
        resourceType="session"
        access={access({ VIEW: ["alice"] })}
        users={USERS}
        groups={GROUPS}
        onApply={vi.fn()}
      />,
    );

    fireEvent.click(card("Alice"));
    expect(setChip("View access").getAttribute("aria-pressed")).toBe("true");

    // The one list mixes kinds, and the union decides the chip state: Editors
    // does not hold VIEW, so the chip drops to partial.
    fireEvent.click(card("Editors"));
    expect(setChip("View access").getAttribute("aria-pressed")).toBe("mixed");
  });
});

describe("ResourceAccessFields — groups", () => {
  it("lists users and groups in one catalog, each with its own detail line", () => {
    render(
      <ResourceAccessFields
        resourceType="session"
        access={access()}
        users={USERS}
        groups={GROUPS}
        onApply={vi.fn()}
      />,
    );

    // Both kinds, no switch: a user card carries @username, a group card the
    // display name and the member count.
    expect(card("Bob")).toBeTruthy();
    expect(card("Editors")).toBeTruthy();
    expect(within(catalog()).getByText("@bob")).toBeTruthy();
    expect(within(catalog()).getByText("editors")).toBeTruthy();
    expect(within(catalog()).getByText("3 members")).toBeTruthy();
    expect(within(catalog()).getByText("1 member")).toBeTruthy();
    expect(
      within(catalog()).getByText("every account, including future ones"),
    ).toBeTruthy();
  });

  it("replace-sets a group's capabilities in the draft on Apply", () => {
    const base = access({
      groupGrants: { VIEW: [2], OPERATE: [2], EDIT: [2] },
    });
    const onApply = vi.fn();
    render(
      <ResourceAccessFields
        resourceType="session"
        access={base}
        users={USERS}
        groups={GROUPS}
        onApply={onApply}
      />,
    );
    fireEvent.click(card("Editors"));
    expect(setChip("Edit").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(setChip("Edit"));
    fireEvent.click(applyButton());

    const target = onApply.mock.calls[0][0] as AccessTarget & GroupDraftTarget;
    expect([...(target.groupGrants?.EDIT ?? [])]).toEqual([]);
    expect([...(target.groupGrants?.OPERATE ?? [])]).toEqual([2]);
    expect([...(target.groupGrants?.VIEW ?? [])]).toEqual([2]);

    fireEvent.click(setChip("View access"));
    fireEvent.click(applyButton());
    const second = onApply.mock.calls[1][0] as AccessTarget & GroupDraftTarget;
    expect([...(second.groupGrants?.VIEW ?? [])]).toEqual([]);
    expect([...(second.groupGrants?.OPERATE ?? [])]).toEqual([]);
  });

  it("adds and removes owner groups without touching the user owner", () => {
    const onApply = vi.fn();
    render(
      <ResourceAccessFields
        resourceType="session"
        access={access({ ownerGroups: [2] })}
        users={USERS}
        groups={GROUPS}
        onApply={onApply}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Remove owner group Editors" }),
    ).toBeTruthy();

    fireEvent.change(screen.getByRole("combobox", { name: "Add an owner" }), {
      target: { value: "operations" },
    });
    fireEvent.click(
      within(ownerList()).getByRole("option", { name: /Operations/ }),
    );
    fireEvent.click(applyButton());

    const target = onApply.mock.calls[0][0] as AccessTarget & GroupDraftTarget;
    expect([...(target.ownerGroups ?? [])].sort((a, b) => a - b)).toEqual([
      2, 3,
    ]);
    expect(target.crown).toEqual(userCrown("kyros"));

    fireEvent.click(
      screen.getByRole("button", { name: "Remove owner group Editors" }),
    );
    fireEvent.click(applyButton());
    const second = onApply.mock.calls[1][0] as AccessTarget & GroupDraftTarget;
    expect([...(second.ownerGroups ?? [])]).toEqual([3]);
    expect(second.crown).toEqual(userCrown("kyros"));
  });

  it("adds the highlighted owner with the arrow keys and enter", () => {
    const onApply = vi.fn();
    const arrowGroups: readonly AccessGroup[] = [
      {
        id: 7,
        name: "zed",
        display_name: "Zed",
        system: false,
        member_count: 2,
      },
      {
        id: 8,
        name: "zeta",
        display_name: "Zeta",
        system: false,
        member_count: 4,
      },
    ];
    render(
      <ResourceAccessFields
        resourceType="session"
        access={access()}
        users={USERS}
        groups={arrowGroups}
        onApply={onApply}
      />,
    );

    const field = screen.getByRole("combobox", { name: "Add an owner" });
    fireEvent.change(field, { target: { value: "ze" } });
    expect(within(ownerList()).getAllByRole("option")).toHaveLength(2);
    fireEvent.keyDown(field, { key: "ArrowDown" });
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.click(applyButton());

    const target = onApply.mock.calls[0][0] as AccessTarget & GroupDraftTarget;
    expect([...(target.ownerGroups ?? [])]).toEqual([8]);
    expect(target.crown).toEqual(userCrown("kyros"));
  });

  it("adds and removes owner users from the owner field without transferring ownership", () => {
    const onApply = vi.fn();
    render(
      <ResourceAccessFields
        resourceType="session"
        access={access()}
        users={USERS}
        groups={GROUPS}
        onApply={onApply}
      />,
    );

    const field = screen.getByRole("combobox", { name: "Add an owner" });
    fireEvent.focus(field);
    const list = ownerList();
    expect(within(list).getByRole("option", { name: /Alice/ })).toBeTruthy();
    expect(within(list).getByRole("option", { name: /Editors/ })).toBeTruthy();
    expect(within(list).queryByRole("option", { name: /Kyros/ })).toBeNull();

    fireEvent.change(field, { target: { value: "alice" } });
    fireEvent.click(within(list).getByRole("option", { name: /Alice/ }));
    fireEvent.click(applyButton());

    const target = onApply.mock.calls[0][0] as AccessTarget & GroupDraftTarget;
    expect(target.crown).toEqual(userCrown("kyros"));
    expect([...(target.ownerUsers ?? [])]).toEqual(["alice"]);
    expect([...(target.ownerGroups ?? [])]).toEqual([]);
  });

  it("removes an owner user from the owner row without touching the owner", () => {
    const onApply = vi.fn();
    render(
      <ResourceAccessFields
        resourceType="session"
        access={access({ ownerUsers: ["alice"] })}
        users={USERS}
        groups={GROUPS}
        onApply={onApply}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove owner alice" }));
    fireEvent.click(applyButton());

    const target = onApply.mock.calls[0][0] as AccessTarget & GroupDraftTarget;
    expect([...(target.ownerUsers ?? [])]).toEqual([]);
    expect(target.crown).toEqual(userCrown("kyros"));
  });

  it("tints only the active search suggestion green, like a picked card", () => {
    render(
      <ResourceAccessFields
        resourceType="session"
        access={access()}
        users={USERS}
        groups={GROUPS}
        onApply={vi.fn()}
      />,
    );

    const field = screen.getByRole("combobox", { name: "Add an owner" });
    fireEvent.focus(field);

    const options = () => within(ownerList()).getAllByRole("option");
    const tinted = () =>
      options().filter((option) =>
        option.className.includes("bg-[var(--accent-dim)]"),
      );
    const selected = () =>
      options().filter(
        (option) => option.getAttribute("aria-selected") === "true",
      );

    expect(tinted()).toEqual(selected());
    expect(tinted()).toHaveLength(1);

    fireEvent.keyDown(field, { key: "ArrowDown" });

    expect(tinted()).toEqual(selected());
    expect(tinted()).toHaveLength(1);
  });

  it("anchors the owner suggestions to the field so they overlay the panel", () => {
    render(
      <ResourceAccessFields
        resourceType="session"
        access={access()}
        users={USERS}
        groups={GROUPS}
        onApply={vi.fn()}
      />,
    );

    const field = screen.getByRole("combobox", { name: "Add an owner" });
    fireEvent.focus(field);
    const list = ownerList();

    expect(field.parentElement?.className).toContain("relative");
    expect(list.parentElement?.className).toContain("absolute");
  });

  it("claims Escape: the field clears and closes its suggestions, not the panel", () => {
    render(
      <ResourceAccessFields
        resourceType="session"
        access={access()}
        users={USERS}
        groups={GROUPS}
        onApply={vi.fn()}
      />,
    );

    const field = screen.getByRole("combobox", { name: "Add an owner" });
    const list = () =>
      screen.queryByRole("listbox", {
        name: "Users and groups to own this item",
      });

    // The wrapper's marker is what tells the enclosing Dialog to skip its dismiss
    // for an Escape that starts in this field (Radix listens in the capture phase,
    // so stopping propagation from here could never have worked).
    expect(field.closest("[data-owns-escape]")).not.toBeNull();

    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "ali" } });
    expect(list()).not.toBeNull();

    fireEvent.keyDown(field, { key: "Escape" });

    expect((field as HTMLInputElement).value).toBe("");
    expect(list()).toBeNull();
  });

  it("warns loudly when the everyone group owns the item", () => {
    render(
      <ResourceAccessFields
        resourceType="session"
        access={access({ ownerGroups: [1] })}
        users={USERS}
        groups={GROUPS}
        onApply={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert").textContent).toBe(
      "Everyone is an owner: every account, including future ones, gets every permission on this item — delete included.",
    );
    expect(
      screen.queryByText("Owners get every permission on this item."),
    ).toBeNull();
  });

  it("raises the everyone warning only once the group is added as an owner", () => {
    render(
      <ResourceAccessFields
        resourceType="session"
        access={access()}
        users={USERS}
        groups={GROUPS}
        onApply={vi.fn()}
      />,
    );

    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Add an owner" }), {
      target: { value: "everyone" },
    });
    fireEvent.click(
      within(ownerList()).getByRole("option", { name: /Everyone/ }),
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "every account, including future ones",
    );
  });

  it("never repeats a crown group as a co-owner badge", () => {
    render(
      <ResourceAccessFields
        resourceType="session"
        access={access({ crown: groupCrown(2), ownerGroups: [2] })}
        users={USERS}
        groups={GROUPS}
        onApply={vi.fn()}
      />,
    );

    expect(screen.getByTestId("owner-crown").textContent).toContain("Editors");
    expect(
      screen.queryByRole("button", { name: "Make Editors the owner" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Remove owner group Editors" }),
    ).toBeNull();
  });

  it("crowns a co-owner from its badge", () => {
    const onApply = vi.fn();
    render(
      <ResourceAccessFields
        resourceType="session"
        access={access({ ownerUsers: ["bob"] })}
        users={USERS}
        groups={GROUPS}
        onApply={onApply}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Make Bob the owner" }));
    fireEvent.click(applyButton());

    const target = onApply.mock.calls[0][0] as AccessTarget;
    expect(target.crown).toEqual(userCrown("bob"));
  });

  it("offers suggestions under the overrides search and picks the one chosen", () => {
    render(
      <ResourceAccessFields
        resourceType="session"
        access={access()}
        users={USERS}
        groups={GROUPS}
        onApply={vi.fn()}
      />,
    );

    fireEvent.change(
      screen.getByRole("combobox", { name: "Search users and groups" }),
      {
        target: { value: "car" },
      },
    );
    const suggestions = screen.getByRole("listbox", {
      name: "Matching users and groups",
    });
    fireEvent.click(within(suggestions).getByRole("option", { name: /Carol/ }));

    expect(card("Carol").getAttribute("aria-selected")).toBe("true");
  });
});
