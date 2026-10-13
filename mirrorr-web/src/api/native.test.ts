import { afterEach, describe, expect, it, vi } from "vitest"
import { HOST_PICKER_URL, isNativeShell, readHostCredential } from "./native"

const internalGetItem = vi.fn()

/**
 * The console calls the plugin's own native method — this bundle carries no JS
 * wrapper for it — with the key already at its final `prefixedKey` form.
 */
function installShell(credential: unknown): void {
  internalGetItem.mockReset()
  internalGetItem.mockResolvedValue({ data: credential })
  ;(globalThis as { Capacitor?: unknown }).Capacitor = {
    isNativePlatform: () => true,
    Plugins: { SecureStorage: { internalGetItem } },
  }
}

function installBridge(capacitor: unknown): void {
  ;(globalThis as { Capacitor?: unknown }).Capacitor = capacitor
}

afterEach(() => {
  delete (globalThis as { Capacitor?: unknown }).Capacitor
})

describe("isNativeShell", () => {
  it("is false in a browser, where no bridge is injected", () => {
    expect(isNativeShell()).toBe(false)
  })

  it("is true inside the app", () => {
    installBridge({ isNativePlatform: () => true, Plugins: {} })
    expect(isNativeShell()).toBe(true)
  })
})

describe("readHostCredential", () => {
  it("reads this host's entry, under the prefix the plugin stores it with", async () => {
    installShell({ username: "kyros", password: "s3cret" })

    await expect(readHostCredential("https://mirrorr.example.org")).resolves.toEqual({
      username: "kyros",
      password: "s3cret",
    })
    expect(internalGetItem).toHaveBeenCalledWith({
      prefixedKey: "capacitor-storage_mirrorr.cred.https://mirrorr.example.org",
      sync: false,
    })
  })

  it("accepts the JSON text the picker actually stores", async () => {
    installShell(JSON.stringify({ username: "kyros", password: "s3cret" }))
    await expect(readHostCredential("https://mirrorr.example.org")).resolves.toEqual({
      username: "kyros",
      password: "s3cret",
    })
  })

  it("is null when there is no entry", async () => {
    installShell(null)
    await expect(readHostCredential("https://mirrorr.example.org")).resolves.toBeNull()
  })

  it("is null without a bridge", async () => {
    await expect(readHostCredential("https://mirrorr.example.org")).resolves.toBeNull()
  })

  it("is null when the keychain cannot be read", async () => {
    installShell(null)
    internalGetItem.mockRejectedValue(new Error("An OS error occurred (-25300)"))
    await expect(readHostCredential("https://mirrorr.example.org")).resolves.toBeNull()
  })

  it("is null when the stored entry is not a credential", async () => {
    installShell("not json at all")
    await expect(readHostCredential("https://mirrorr.example.org")).resolves.toBeNull()
  })

  it("is null when the password is missing", async () => {
    installShell({ username: "kyros" })
    await expect(readHostCredential("https://mirrorr.example.org")).resolves.toBeNull()
  })
})

describe("HOST_PICKER_URL", () => {
  it("points at the shell's own bundled content", () => {
    expect(HOST_PICKER_URL).toBe("capacitor://localhost/")
  })
})
