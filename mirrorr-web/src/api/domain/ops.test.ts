import { describe, expect, it } from "vitest"
import {
  DISK_DANGER_BYTES,
  DISK_WARNING_BYTES,
  diskTone,
  liveReadout,
  nextRunReadout,
  storageReadout,
} from "./ops"

const sessions = (patch: Partial<Parameters<typeof liveReadout>[0]> = {}) => ({
  running: 0,
  live: 0,
  starting: 0,
  finishing: 0,
  failed_24h: 0,
  total: 0,
  ...patch,
})

describe("diskTone", () => {
  it("is normal on a roomy disk", () => {
    expect(diskTone(60 * 1024 ** 3)).toBe("normal")
  })

  it("warns below ten gigabytes of free space", () => {
    expect(diskTone(DISK_WARNING_BYTES - 1)).toBe("warning")
    expect(diskTone(DISK_WARNING_BYTES)).toBe("normal")
  })

  it("is in danger at the level the core refuses a capture", () => {
    expect(diskTone(DISK_DANGER_BYTES - 1)).toBe("danger")
    expect(diskTone(DISK_DANGER_BYTES)).toBe("warning")
  })
})

describe("liveReadout", () => {
  it("counts only running captures as live", () => {
    expect(liveReadout(sessions({ live: 3, starting: 1, finishing: 2 })).live).toBe(3)
  })

  it("names what is on its way in or out beside the live count", () => {
    expect(liveReadout(sessions({ live: 1, starting: 2, finishing: 1 })).notes).toEqual([
      "2 starting",
      "1 finishing",
    ])
  })

  it("says nothing when a run is neither starting nor finishing", () => {
    expect(liveReadout(sessions({ live: 2 })).notes).toEqual([])
  })
})

describe("storageReadout", () => {
  it("reads count, bytes and clock", () => {
    expect(
      storageReadout({ count: 12, size_bytes: 34 * 1024 ** 3, seconds: 6 * 3600 + 13 * 60 + 20 }),
    ).toBe("12 recordings · 34.0 GB · 6:13:20")
  })

  it("uses the singular for one recording", () => {
    expect(storageReadout({ count: 1, size_bytes: 1024, seconds: 0 })).toBe("1 recording · 1.0 KB")
  })

  it("leaves the clock out when no duration is known", () => {
    expect(storageReadout({ count: 2, size_bytes: 0, seconds: 0 })).toBe("2 recordings · 0 B")
  })
})

describe("nextRunReadout", () => {
  const now = new Date("2026-10-27T12:00:00Z")

  it("answers nothing when no schedule is pending", () => {
    expect(nextRunReadout(null, now)).toBeNull()
    expect(nextRunReadout(undefined, now)).toBeNull()
  })

  it("names the schedule with the time it has left", () => {
    expect(
      nextRunReadout(
        { id: 7, name: "mexico_gp_race", starts_at: "2026-10-27 14:00:00", status: "scheduled" },
        now,
      ),
    ).toEqual({ name: "mexico_gp_race", countdown: "starts in ~2 h" })
  })
})
