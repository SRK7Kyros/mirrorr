import { useCallback, useEffect, useState } from "react"

const DEFAULT_LOCK_MS = 30_000
const TICK_MS = 1_000

export interface RateLimitLock {
  readonly locked: boolean
  readonly remainingSeconds: number
  readonly lock: () => void
}

/** 429 submit lockout with a live countdown (spec §5 V1: 30s disable + countdown). */
export function useRateLimitLock(durationMs: number = DEFAULT_LOCK_MS): RateLimitLock {
  const [lockUntil, setLockUntil] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const locked = lockUntil > now

  useEffect(() => {
    if (!locked) return
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS)
    return () => window.clearInterval(id)
  }, [locked])

  const lock = useCallback(() => {
    setLockUntil(Date.now() + durationMs)
    setNow(Date.now())
  }, [durationMs])

  const remainingSeconds = locked ? Math.ceil((lockUntil - now) / 1000) : 0
  return { locked, remainingSeconds, lock }
}
