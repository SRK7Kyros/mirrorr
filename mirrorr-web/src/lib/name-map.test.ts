import { describe, expect, it, vi } from "vitest"
import {
  createNameMapStore,
  nameMapKindForEvent,
  type NameMapEntity,
  type NameMapKind,
} from "@/lib/name-map"

/**
 * Name memo map (`docs/general-client-specification.md` §13.13, request-savings
 * table): one `GET /engines/` + `/resolvers/` + `/profiles/` builds the local
 * `id→name` map, invalidated on the matching WS `*.updated/deleted` events.
 */

const ENGINE_ENTITIES: readonly NameMapEntity[] = [
  { id: 1, name: "Engine One" },
  { id: 2, name: "Engine Two" },
]

describe("createNameMapStore", () => {
  it("resolves many ids from exactly one fetch per kind", async () => {
    const load = vi.fn(async (kind: NameMapKind) =>
      kind === "engine" ? ENGINE_ENTITIES : [{ id: 9, name: "Plugin Nine" }],
    )
    const store = createNameMapStore(load)

    await Promise.all([store.ensure("engine"), store.ensure("engine"), store.ensure("engine")])
    await store.ensure("engine")

    expect(load).toHaveBeenCalledTimes(1)
    expect(store.get("engine", 1)).toBe("Engine One")
    expect(store.get("engine", 2)).toBe("Engine Two")
    expect(store.get("engine", 404)).toBeUndefined()
  })

  it("keeps separate single-flight loads per kind", async () => {
    const load = vi.fn(async (kind: NameMapKind) =>
      kind === "engine" ? ENGINE_ENTITIES : [{ id: 9, name: "Plugin Nine" }],
    )
    const store = createNameMapStore(load)

    await Promise.all([store.ensure("engine"), store.ensure("resolver"), store.ensure("profile")])

    expect(load).toHaveBeenCalledTimes(3)
    expect(load.mock.calls.map(([kind]) => kind).sort()).toEqual(["engine", "profile", "resolver"])
  })

  it("refetches only after invalidation", async () => {
    const load = vi.fn(async () => ENGINE_ENTITIES)
    const store = createNameMapStore(load)

    await store.ensure("engine")
    expect(store.get("engine", 1)).toBe("Engine One")

    store.invalidate("engine")
    expect(store.get("engine", 1)).toBeUndefined()
    await store.ensure("engine")

    expect(load).toHaveBeenCalledTimes(2)
    expect(store.get("engine", 1)).toBe("Engine One")
  })

  it("allows a retry after a failed load", async () => {
    const load = vi
      .fn<(kind: NameMapKind) => Promise<readonly NameMapEntity[]>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(ENGINE_ENTITIES)
    const store = createNameMapStore(load)

    await expect(store.ensure("engine")).rejects.toThrow("offline")
    await store.ensure("engine")

    expect(store.get("engine", 1)).toBe("Engine One")
  })

  it("notifies subscribers when a map changes", async () => {
    const listener = vi.fn()
    const store = createNameMapStore(async () => ENGINE_ENTITIES)

    const unsubscribe = store.subscribe(listener)
    await store.ensure("engine")
    unsubscribe()
    store.invalidate("engine")

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("invalidateForEvent maps WS entity events onto the right kind", async () => {
    const load = vi.fn(async () => ENGINE_ENTITIES)
    const store = createNameMapStore(load)

    await store.ensure("engine")
    expect(store.invalidateForEvent("engine.updated")).toBe("engine")
    expect(store.invalidateForEvent("session.updated")).toBeNull()
    await store.ensure("engine")

    expect(load).toHaveBeenCalledTimes(2)
  })
})

describe("nameMapKindForEvent", () => {
  it("recognises the plugin entity families", () => {
    expect(nameMapKindForEvent("engine.updated")).toBe("engine")
    expect(nameMapKindForEvent("engine.deleted")).toBe("engine")
    expect(nameMapKindForEvent("resolver.created")).toBe("resolver")
    expect(nameMapKindForEvent("profile.updated")).toBe("profile")
  })

  it("ignores unrelated events", () => {
    expect(nameMapKindForEvent("session.updated")).toBeNull()
    expect(nameMapKindForEvent("")).toBeNull()
  })
})
