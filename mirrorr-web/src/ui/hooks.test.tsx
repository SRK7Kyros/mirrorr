import { describe, expect, it } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { useScopedSelection } from "./hooks"

describe("useScopedSelection", () => {
  it("drops a selected id when the visible scope changes", () => {
    const { result, rerender } = renderHook(({ ids }: { ids: number[] }) => useScopedSelection(ids), {
      initialProps: { ids: [1, 2, 3] },
    })

    act(() => result.current.setMany([1, 3]))
    expect(result.current.count).toBe(2)

    rerender({ ids: [1] })
    expect(result.current.count).toBe(1)
    expect(result.current.has(1)).toBe(true)
    expect(result.current.has(3)).toBe(false)
  })

  it("reports ids that fell outside the visible set instead of losing them silently", () => {
    const { result, rerender } = renderHook(({ ids }: { ids: number[] }) => useScopedSelection(ids), {
      initialProps: { ids: [1, 2, 3] },
    })

    act(() => result.current.setMany([2, 3]))
    rerender({ ids: [1, 2] })

    expect(result.current.outside).toBe(0)
    expect(result.current.count).toBe(1)
  })
})
