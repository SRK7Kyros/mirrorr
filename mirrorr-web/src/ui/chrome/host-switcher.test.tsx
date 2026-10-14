import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HostSwitcher } from "./host-switcher";

const origin = window.location.origin;

interface StoredState {
  readonly servers: readonly { readonly name: string; readonly url: string }[];
  readonly lastUrl?: string | null;
  readonly autoUrl?: string | null;
}

/** The app's bridge, with the picker's own store behind it. */
function installShell(initial: StoredState | null) {
  let stored = initial === null ? null : JSON.stringify(initial);
  const writes: string[] = [];
  (globalThis as { Capacitor?: unknown }).Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => "ios",
    Plugins: {
      Preferences: {
        get: async () => ({ value: stored }),
        set: async ({ value }: { readonly value: string }) => {
          writes.push(value);
          stored = value;
        },
      },
    },
  };
  return { writes };
}

function autoSwitch(): HTMLInputElement {
  return screen.getByRole("menuitemcheckbox", {
    name: "Auto-connect on start",
  }) as HTMLInputElement;
}

afterEach(() => {
  delete (globalThis as { Capacitor?: unknown }).Capacitor;
});

describe("HostSwitcher", () => {
  it("renders nothing in a browser, which has no shell store to read", () => {
    const { container } = render(<HostSwitcher />);
    expect(container.innerHTML).toBe("");
  });

  it("names the host this console is running from", async () => {
    installShell({
      servers: [{ name: "Home server", url: origin }],
      autoUrl: null,
    });
    render(<HostSwitcher />);

    expect(await screen.findByText("Home server")).toBeTruthy();
    expect(autoSwitch().checked).toBe(false);
  });

  it("falls back to the address when the picker never named this host", async () => {
    installShell({ servers: [] });
    render(<HostSwitcher />);

    expect(await screen.findByText(window.location.host)).toBeTruthy();
  });

  it("is already on for the host the shell opens on launch", async () => {
    installShell({
      servers: [{ name: "Home server", url: origin }],
      autoUrl: origin,
    });
    render(<HostSwitcher />);

    await screen.findByText("Home server");
    expect(autoSwitch().checked).toBe(true);
  });

  it("aims the next launch at this host, and takes it back off", async () => {
    const { writes } = installShell({
      servers: [{ name: "Home server", url: origin }],
      autoUrl: null,
    });
    render(<HostSwitcher />);
    await screen.findByText("Home server");

    fireEvent.click(autoSwitch());
    await waitFor(() => expect(writes).toHaveLength(1));
    expect((JSON.parse(writes[0] ?? "") as { autoUrl?: unknown }).autoUrl).toBe(
      origin,
    );

    fireEvent.click(autoSwitch());
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(
      (JSON.parse(writes[1] ?? "") as { autoUrl?: unknown }).autoUrl,
    ).toBeNull();
  });
});
