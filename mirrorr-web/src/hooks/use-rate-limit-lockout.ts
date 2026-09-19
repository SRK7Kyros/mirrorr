import { useCallback, useEffect, useState } from "react"

/** Spec L156: a 429 disables the submit for 30 seconds. */
export const SUBMIT_LOCKOUT_MS = 30_000

export interface RateLimitLockout {
  readonly isLocked: boolean
  readonly lock: () => void
}

export function useRateLimitLockout(): RateLimitLockout {
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    if (generation === 0) return undefined
    const handle = setTimeout(() => setGeneration(0), SUBMIT_LOCKOUT_MS)
    return () => clearTimeout(handle)
  }, [generation])

  const lock = useCallback(() => setGeneration((current) => current + 1), [])

  return { isLocked: generation > 0, lock }
}
