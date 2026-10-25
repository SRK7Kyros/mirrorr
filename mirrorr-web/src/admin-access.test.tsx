import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  BulkAccessDialog,
  CreationAccess,
  ResourceAccessButton,
  applyCreationAccess,
} from "./admin-access";

const api = vi.hoisted(() => ({
  fetchUsers: vi.fn(),
  fetchGroups: vi.fn(),
  fetchResourceAccess: vi.fn(),
  setResourceGrants: vi.fn(),
  revokeResourceUser: vi.fn(),
  addResourceOwnerUser: vi.fn(),
  setResourceOwner: vi.fn(),
  useAuthState: vi.fn(() => ({
    status: "authenticated",
    auth: { user: { id: 1, username: "kyros", role: "admin", display_name: "Kyros" } },
  })),
  getErrorMessage: vi.fn((_error: unknown, fallback: string) => fallback),
}));

vi.mock("@/api", () => api);
// The panel and the planner read the endpoint module directly, not the barrel.
vi.mock("@/api/endpoints/access", () => api);

const USERS = [
  { id: 1, username: "kyros", role: "admin", display_name: "Kyros" },
  { id: 2, username: "alice", role: "user", display_name: "Alice" },
];

function accessView() {
  return {
    resource_type: "session",
    id: 7,
    owner: "kyros",
    owner_missing: false,
    grants: [],
  };
}

/** The affordances live inside a clickable card, so every test mounts them in one. */
function renderInCard(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const openCard = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <div data-testid="card" onClick={openCard}>
        {node}
      </div>
    </QueryClientProvider>,
  );
  return openCard;
}

beforeEach(() => {
  vi.resetAllMocks();
  api.fetchUsers.mockResolvedValue(USERS);
  api.fetchGroups.mockResolvedValue({ items: [], total: 0 });
  api.fetchResourceAccess.mockResolvedValue(accessView());
});

describe("access affordances keep their clicks off the card", () => {
  it("swallows a click on the button and on the panel", async () => {
    const openCard = renderInCard(
      <ResourceAccessButton resourceType="session" id={7} label="F1 Weekend" />,
    );

    fireEvent.click(screen.getByTestId("card"));
    expect(openCard).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole("button", { name: "Access for F1 Weekend" }),
    );
    expect(openCard).toHaveBeenCalledTimes(1);

    fireEvent.click(await screen.findByText("Access · F1 Weekend"));
    expect(openCard).toHaveBeenCalledTimes(1);
  });

  it("mounts one centered dialog panel, not a sheet, and keeps its body clicks off the card", async () => {
    const openCard = renderInCard(
      <ResourceAccessButton resourceType="session" id={7} label="F1 Weekend" />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Access for F1 Weekend" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Access · F1 Weekend")).toBeTruthy();
    expect(within(dialog).getByText("Session · #7")).toBeTruthy();
    expect(openCard).toHaveBeenCalledTimes(0);

    fireEvent.click(
      await within(dialog).findByLabelText("Search users and groups"),
    );
    fireEvent.click(within(dialog).getByTestId("owner-crown"));
    fireEvent.click(within(dialog).getByTestId("access-catalog"));
    expect(openCard).toHaveBeenCalledTimes(0);
  });

  it("swallows a click on the bulk panel", async () => {
    const openCard = renderInCard(
      <BulkAccessDialog
        resourceType="autorun"
        items={[{ id: 5, label: "F1 Race" }]}
        onClose={() => undefined}
      />,
    );

    fireEvent.click(screen.getByTestId("card"));
    expect(openCard).toHaveBeenCalledTimes(1);

    fireEvent.click(await screen.findByText("Access on 1 item(s)"));
    expect(openCard).toHaveBeenCalledTimes(1);
  });
});

describe("the creation panel's access section", () => {
  it("starts collapsed, reports its draft upward, and applies it once the row exists", async () => {
    api.setResourceGrants.mockResolvedValue(accessView());
    const onChange = vi.fn();
    renderInCard(<CreationAccess resourceType="session" onChange={onChange} />);

    // Mount reports the empty draft, which is what a create with no grants sends.
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({ grants: { VIEW: [] } });
    expect(screen.getByTestId("access-creation-toggle").textContent).toContain(
      "Owners only",
    );
    expect(screen.queryByTestId("access-catalog")).toBeNull();

    fireEvent.click(screen.getByTestId("access-creation-toggle"));
    fireEvent.click(
      within(screen.getByTestId("access-catalog")).getByRole("option", {
        name: /Alice/,
      }),
    );
    fireEvent.click(
      within(
        screen.getByRole("group", {
          name: "Capabilities for the selected users and groups",
        }),
      ).getByRole("button", { name: "View access" }),
    );

    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          grants: expect.objectContaining({ VIEW: ["alice"] }),
        }),
      ),
    );
    expect(screen.getByTestId("access-creation-toggle").textContent).toContain(
      "1 principal",
    );

    await applyCreationAccess("session", 12, { grants: { VIEW: ["alice"] } });
    expect(api.setResourceGrants).toHaveBeenCalledWith("session", 12, "alice", [
      "VIEW",
    ]);
  });

  it("names co-owners through the same owner field and applies them on create", async () => {
    api.setResourceGrants.mockResolvedValue(accessView());
    api.addResourceOwnerUser.mockResolvedValue(accessView());
    const onChange = vi.fn();
    renderInCard(<CreationAccess resourceType="session" onChange={onChange} />);

    fireEvent.click(screen.getByTestId("access-creation-toggle"));
    await screen.findByTestId("access-catalog");
    // The creator is already the crown, so the slot says so before anything is picked.
    expect(screen.getByTestId("owner-crown").textContent).toContain("Kyros");

    fireEvent.change(screen.getByLabelText("Add an owner"), {
      target: { value: "Alice" },
    });
    fireEvent.click(
      within(
        await screen.findByRole("listbox", { name: /own this item/ }),
      ).getByRole("option", { name: /Alice/ }),
    );

    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ ownerUsers: ["alice"] }),
      ),
    );
    expect(screen.getByTestId("access-creation-toggle").textContent).toContain(
      "1 owner",
    );

    await applyCreationAccess("session", 12, { ownerUsers: ["alice"] });
    expect(api.addResourceOwnerUser).toHaveBeenCalledWith(
      "session",
      12,
      "alice",
    );
  });

  it("hands the item over when an added owner is crowned", async () => {
    api.setResourceOwner.mockResolvedValue(accessView());
    const onChange = vi.fn();
    renderInCard(<CreationAccess resourceType="session" onChange={onChange} />);

    fireEvent.click(screen.getByTestId("access-creation-toggle"));
    await screen.findByTestId("access-catalog");
    fireEvent.change(screen.getByLabelText("Add an owner"), {
      target: { value: "Alice" },
    });
    fireEvent.click(
      within(
        await screen.findByRole("listbox", { name: /own this item/ }),
      ).getByRole("option", { name: /Alice/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Make Alice the owner" }));

    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          ownerUsers: ["alice"],
          crown: { kind: "user", username: "alice" },
        }),
      ),
    );
    expect(screen.getByTestId("owner-crown").textContent).toContain("Alice");
    // A crown move takes the item away from whoever created it.
    expect(screen.getByText("Alice will own this item — you will not.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Keep me as the owner" }));
    await waitFor(() =>
      expect(onChange.mock.calls.at(-1)?.[0].crown).toBeUndefined(),
    );
    expect(screen.getByTestId("owner-crown").textContent).toContain("Kyros");

    fireEvent.click(screen.getByRole("button", { name: "Make Alice the owner" }));
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ crown: { kind: "user", username: "alice" } }),
      ),
    );

    await applyCreationAccess("session", 12, { crown: { kind: "user", username: "alice" } });
    expect(api.setResourceOwner).toHaveBeenCalledWith("session", 12, {
      username: "alice",
    });
  });
});
