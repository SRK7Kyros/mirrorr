import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hostPickerUrl,
  installShellBackHandler,
  isNativeShell,
  readHostCredential,
  readShellHosts,
} from "./native";

const internalGetItem = vi.fn();

/**
 * The console calls the plugin's own native method — this bundle carries no JS
 * wrapper for it — with the key already at its final `prefixedKey` form.
 */
function installShell(credential: unknown): void {
  internalGetItem.mockReset();
  internalGetItem.mockResolvedValue({ data: credential });
  (globalThis as { Capacitor?: unknown }).Capacitor = {
    isNativePlatform: () => true,
    Plugins: { SecureStorage: { internalGetItem } },
  };
}

function installBridge(capacitor: unknown): void {
  (globalThis as { Capacitor?: unknown }).Capacitor = capacitor;
}

afterEach(() => {
  delete (globalThis as { Capacitor?: unknown }).Capacitor;
});

describe("isNativeShell", () => {
  it("is false in a browser, where no bridge is injected", () => {
    expect(isNativeShell()).toBe(false);
  });

  it("is true inside the app", () => {
    installBridge({ isNativePlatform: () => true, Plugins: {} });
    expect(isNativeShell()).toBe(true);
  });
});

describe("readHostCredential", () => {
  it("reads this host's entry, under the prefix the plugin stores it with", async () => {
    installShell({ username: "kyros", password: "s3cret" });

    await expect(
      readHostCredential("https://mirrorr.example.org"),
    ).resolves.toEqual({
      username: "kyros",
      password: "s3cret",
    });
    expect(internalGetItem).toHaveBeenCalledWith({
      prefixedKey: "capacitor-storage_mirrorr.cred.https://mirrorr.example.org",
      sync: false,
    });
  });

  it("accepts the JSON text the picker actually stores", async () => {
    installShell(JSON.stringify({ username: "kyros", password: "s3cret" }));
    await expect(
      readHostCredential("https://mirrorr.example.org"),
    ).resolves.toEqual({
      username: "kyros",
      password: "s3cret",
    });
  });

  it("is null when there is no entry", async () => {
    installShell(null);
    await expect(
      readHostCredential("https://mirrorr.example.org"),
    ).resolves.toBeNull();
  });

  it("is null without a bridge", async () => {
    await expect(
      readHostCredential("https://mirrorr.example.org"),
    ).resolves.toBeNull();
  });

  it("is null when the keychain cannot be read", async () => {
    installShell(null);
    internalGetItem.mockRejectedValue(
      new Error("An OS error occurred (-25300)"),
    );
    await expect(
      readHostCredential("https://mirrorr.example.org"),
    ).resolves.toBeNull();
  });

  it("is null when the stored entry is not a credential", async () => {
    installShell("not json at all");
    await expect(
      readHostCredential("https://mirrorr.example.org"),
    ).resolves.toBeNull();
  });

  it("is null when the password is missing", async () => {
    installShell({ username: "kyros" });
    await expect(
      readHostCredential("https://mirrorr.example.org"),
    ).resolves.toBeNull();
  });
});

describe("hostPickerUrl", () => {
  it("is the iOS local scheme when no bridge is injected", () => {
    expect(hostPickerUrl()).toBe("capacitor://localhost/");
  });

  it("follows the platform's own local origin", () => {
    installBridge({
      isNativePlatform: () => true,
      getPlatform: () => "ios",
      Plugins: {},
    });
    expect(hostPickerUrl()).toBe("capacitor://localhost/");

    installBridge({
      isNativePlatform: () => true,
      getPlatform: () => "android",
      Plugins: {},
    });
    expect(hostPickerUrl()).toBe("https://localhost/");
  });
});

describe("installShellBackHandler", () => {
  const addListener = vi.fn();
  const exitApp = vi.fn();

  function installAppPlugin(platform: string): void {
    addListener.mockReset();
    exitApp.mockReset();
    installBridge({
      isNativePlatform: () => true,
      getPlatform: () => platform,
      Plugins: { App: { addListener, exitApp } },
    });
  }

  it("does nothing where there is no back button", () => {
    installShellBackHandler();
    expect(addListener).not.toHaveBeenCalled();

    installAppPlugin("ios");
    installShellBackHandler();
    expect(addListener).not.toHaveBeenCalled();
  });

  it("does nothing when the app plugin is not linked", () => {
    installBridge({
      isNativePlatform: () => true,
      getPlatform: () => "android",
      Plugins: {},
    });
    expect(() => installShellBackHandler()).not.toThrow();
    expect(addListener).not.toHaveBeenCalled();
  });

  it("walks the WebView's own history back when there is one", () => {
    installAppPlugin("android");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    installShellBackHandler();

    expect(addListener).toHaveBeenCalledWith(
      "backButton",
      expect.any(Function),
    );
    (
      addListener.mock.calls[0] as [
        string,
        (payload: { canGoBack?: boolean }) => void,
      ]
    )[1]({ canGoBack: true });

    expect(back).toHaveBeenCalled();
    expect(exitApp).not.toHaveBeenCalled();
    back.mockRestore();
  });

  it("quits the app when there is nowhere left to go", () => {
    installAppPlugin("android");
    installShellBackHandler();

    (
      addListener.mock.calls[0] as [
        string,
        (payload: { canGoBack?: boolean }) => void,
      ]
    )[1]({ canGoBack: false });

    expect(exitApp).toHaveBeenCalled();
  });
});

describe("readShellHosts", () => {
  function installPreferences(value: unknown): void {
    installBridge({
      isNativePlatform: () => true,
      Plugins: { Preferences: { get: async () => ({ value }) } },
    });
  }

  it("reads the picker's hosts and the origin its launch is aimed at", async () => {
    installPreferences(
      JSON.stringify({
        servers: [{ name: "Home server", url: "https://mirrorr.example.org" }],
        lastUrl: "https://mirrorr.example.org",
        autoUrl: "https://mirrorr.example.org",
      }),
    );

    await expect(readShellHosts()).resolves.toEqual({
      hosts: [{ name: "Home server", url: "https://mirrorr.example.org" }],
      autoUrl: "https://mirrorr.example.org",
    });
  });

  it("is null without a bridge, and without an entry to read", async () => {
    await expect(readShellHosts()).resolves.toBeNull();

    installPreferences(null);
    await expect(readShellHosts()).resolves.toBeNull();

    installPreferences("");
    await expect(readShellHosts()).resolves.toBeNull();
  });

  it("is null when the stored value is not the picker's state", async () => {
    installPreferences("not json at all");
    await expect(readShellHosts()).resolves.toBeNull();

    installPreferences(
      JSON.stringify({ lastUrl: "https://mirrorr.example.org" }),
    );
    await expect(readShellHosts()).resolves.toBeNull();
  });

  it("keeps only the hosts it can both name and address", async () => {
    installPreferences(
      JSON.stringify({
        servers: [
          { name: "Home server", url: "https://a.example" },
          { name: "No URL" },
          null,
        ],
      }),
    );

    await expect(readShellHosts()).resolves.toEqual({
      hosts: [{ name: "Home server", url: "https://a.example" }],
      autoUrl: null,
    });
  });
});
