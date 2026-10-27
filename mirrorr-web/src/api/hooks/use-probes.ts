import { useCallback, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import type { ProbeVerdict } from "@/api/schemas"
import { captureKey } from "@/api/domain/fallback-chain"
import { lookupProbes, probeResolver, type ProbeLookupSource } from "@/api/endpoints"
import { queryKeys } from "@/api/query-keys"

/**
 * A capture worth checking — the engine it would run behind and the stream it
 * would take. Any shape carrying those three fields works: a chain rung's
 * resolved capture, a profile's own source, an autorun's base.
 */
export interface ProbedCapture {
  readonly engine_id: number
  readonly resolver_id: number
  readonly resolver_config?: unknown
}

export interface ProbeVerdicts {
  /** The freshest verdict for a capture, or `null` while it has never been checked. */
  verdict(capture: ProbedCapture | null): ProbeVerdict | null
  /** True while this capture's own check is in flight. */
  testing(capture: ProbedCapture | null): boolean
  /** Check one capture now — the same work a scheduled run does before it starts. */
  test(capture: ProbedCapture): void
}

const NOTHING: ProbeVerdicts = {
  verdict: () => null,
  testing: () => false,
  test: () => undefined,
}

function configOf(capture: ProbedCapture): Record<string, unknown> {
  return (capture.resolver_config as Record<string, unknown> | null | undefined) ?? {}
}

/**
 * The last verdict each of these captures got, plus a way to check one again.
 *
 * Opening an editor reads what is already known (`/resolvers/probes/lookup`, no
 * resolve paid), so a rung whose source was last seen dark is marked before the
 * user asks anything. Testing one capture writes its answer back into the same
 * map, so the mark updates in place.
 */
export function useProbeVerdicts(captures: readonly ProbedCapture[]): ProbeVerdicts {
  const keys = useMemo(() => captures.map((capture) => captureKey(capture)), [captures])
  const sources = useMemo<ProbeLookupSource[]>(
    () =>
      captures.map((capture) => ({
        engine_id: capture.engine_id,
        resolver_id: capture.resolver_id,
        resolver_config: configOf(capture),
      })),
    [captures],
  )

  const query = useQuery({
    queryKey: queryKeys.probes(keys),
    queryFn: () => lookupProbes(sources),
    enabled: keys.length > 0,
    staleTime: 30_000,
  })

  const [fresh, setFresh] = useState<Readonly<Record<string, ProbeVerdict>>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const stored = useMemo(() => {
    const map = new Map<string, ProbeVerdict | null>()
    keys.forEach((key, index) => map.set(key, query.data?.[index] ?? null))
    return map
  }, [keys, query.data])

  const verdict = useCallback(
    (capture: ProbedCapture | null): ProbeVerdict | null => {
      if (capture === null) return null
      const key = captureKey(capture)
      return fresh[key] ?? stored.get(key) ?? null
    },
    [fresh, stored],
  )

  const testing = useCallback(
    (capture: ProbedCapture | null): boolean => capture !== null && busy === captureKey(capture),
    [busy],
  )

  const test = useCallback((capture: ProbedCapture): void => {
    const key = captureKey(capture)
    setBusy(key)
    void probeResolver(capture.resolver_id, {
      resolver_config: configOf(capture),
      engine_id: capture.engine_id,
    })
      .then((result) => {
        setFresh((current) => ({ ...current, [key]: result }))
      })
      .catch((error: unknown) => {
        setFresh((current) => ({
          ...current,
          [key]: {
            ok: false,
            latency_ms: 0,
            error: error instanceof Error ? error.message : "The check could not be run.",
          },
        }))
      })
      .finally(() => {
        setBusy((current) => (current === key ? null : current))
      })
  }, [])

  return useMemo(() => ({ verdict, testing, test }), [verdict, testing, test])
}

/** A hook that answers nothing — for a surface with no captures to watch. */
export function useNoProbes(): ProbeVerdicts {
  return NOTHING
}
