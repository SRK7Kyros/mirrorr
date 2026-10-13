import { afterEach, describe, expect, it, vi } from "vitest"
import { HOST_PICKER_URL, isNativeShell, readHostCredential } from "./native"

function installBridge(capacitor: unknown): void {
  ;(globalThis as { Capacitor?: unknown }).Capacitor = capacitor
}

function shellWith(get: unknown) {
  return { isNativePlatform: () => true, Plugins: { SecureStorage: { get } } }
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
  it("reads the entry stored under this origin", async () => {
    const get = vi.fn().mockResolvedValue(JSON.stringify({ username: "kyros", password: "s3cret" }))
    installBridge(shellWith(get))

    await expect(readHostCredential("https://mirrorr.example.org")).resolves.toEqual({
      username: "kyros",
      password: "s3cret",
    })
    expect(get).toHaveBeenCalledWith("mirrorr.cred.https://mirrorr.example.org")
  })

  it("is null without a bridge", async () => {
    await expect(readHostCredential("https://mirrorr.example.org")).resolves.toBeNull()
  })

  it("is null when the keychain refuses to open", async () => {
    installBridge(shellWith(vi.fn().mockRejectedValue(new Error("keychain denied"))))
    await expect(readHostCredential("https://mirrorr.example.org")).resolves.toBeNull()
  })

  it("is null when the stored entry is not a credential", async () => {
    installBridge(shellWith(vi.fn().mockResolvedValue("not json at all")))
    await expect(readHostCredential("https://mirrorr.example.org")).resolves.toBeNull()
  })

  it("is null when the password is missing", async () => {
    installBridge(shellWith(vi.fn().mockResolvedValue(JSON.stringify({ username: "kyros" }))))
    await expect(readHostCredential("https://mirrorr.example.org")).resolves.toBeNull()
  })
})

describe("HOST_PICKER_URL", () => {
  it("points at the shell's own bundled content", () => {
    expect(HOST_PICKER_URL).toBe("capacitor://localhost/")
  })
})
