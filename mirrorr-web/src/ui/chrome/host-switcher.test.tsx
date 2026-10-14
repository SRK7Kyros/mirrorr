import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HostSwitcher } from "./host-switcher";

const origin = window.location.origin;

/** The app's bridge, with the picker's own store behind it. */
function installShell(stored: unknown) {
  (globalThis as { Capacitor?: unknown }).Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => "ios",
    Plugins: {
      Preferences: {
        get: async () => ({
          value: stored === null ? null : JSON.stringify(stored),
        }),
      },
    },
  };
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
    installShell({ servers: [{ name: "Home server", url: origin }] });
    render(<HostSwitcher />);

    expect(await screen.findByText("Home server")).toBeTruthy();
  });

  it("falls back to the address when the picker never named this host", async () => {
    installShell({ servers: [] });
    render(<HostSwitcher />);

    expect(await screen.findByText(window.location.host)).toBeTruthy();
  });

  it("offers the way back to the host list", async () => {
    installShell({ servers: [{ name: "Home server", url: origin }] });
    render(<HostSwitcher />);
    await screen.findByText("Home server");

    const link = screen.getByRole("menuitem", { name: /switch server/i });
    expect(link.getAttribute("href")).toContain("localhost");
  });
});
