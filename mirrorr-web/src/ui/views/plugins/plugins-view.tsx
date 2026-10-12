import { useQuery } from "@tanstack/react-query"
import { motion } from "motion/react"
import { fetchAllEngines, fetchAllResolvers, getErrorMessage } from "@/api"
import { queryKeys, staleTimes } from "@/api/query-keys"
import type { Capabilities, Engine, Resolver } from "@/api/schemas"
import {
  Badge,
  EmptyState,
  ErrorPanel,
  Hash,
  JsonView,
  Panel,
  PanelBody,
  PanelHead,
  SkeletonRows,
  Table,
  Td,
  Th,
  panelBodyClass,
} from "@/ui/components"
import { staggerContainer, staggerItem } from "@/ui/lib/motion"
import { Page } from "@/ui/views/shared/page"

interface PluginEntry {
  readonly id: number
  readonly name: string
  readonly description?: string
  readonly origin: string
  readonly originHash: string
  readonly capabilities?: Capabilities
  readonly configSchema?: Record<string, unknown>
}

function toEngineEntry(engine: Engine): PluginEntry {
  return {
    id: engine.id,
    name: engine.name,
    description: engine.description,
    origin: engine.origin,
    originHash: engine.origin_hash,
    capabilities: engine.capabilities ?? {},
  }
}

function toResolverEntry(resolver: Resolver): PluginEntry {
  return {
    id: resolver.id,
    name: resolver.name,
    description: resolver.description,
    origin: resolver.origin,
    originHash: resolver.origin_hash,
    configSchema: resolver.config_schema,
  }
}

const CAPABILITY_FLAGS = [
  { key: "can_stream", label: "Stream" },
  { key: "can_record", label: "Record" },
] as const

function CapabilityBadges({ entry }: { readonly entry: PluginEntry }) {
  return (
    <>
      {CAPABILITY_FLAGS.map(({ key, label }) => {
        const supported = entry.capabilities?.[key] === true
        return (
          <Badge
            key={key}
            variant={supported ? "accent" : "danger"}
            title={`${label}: ${supported ? "supported" : "not supported"}`}
          >
            {label}
          </Badge>
        )
      })}
    </>
  )
}

function EntryMeta({ entry }: { readonly entry: PluginEntry }) {
  if (entry.capabilities !== undefined) {
    return (
      <div className="flex flex-col items-center gap-1">
        <CapabilityBadges entry={entry} />
      </div>
    )
  }
  return <JsonView value={entry.configSchema ?? {}} />
}

export function PluginsView() {
  // The same query keys/queryFns as `useEngines`/`useResolvers`, subscribed
  // directly so the panels can render their loading and error states.
  const enginesQuery = useQuery({
    queryKey: queryKeys.engines,
    queryFn: () => fetchAllEngines(),
    staleTime: staleTimes.lookup,
  })
  const resolversQuery = useQuery({
    queryKey: queryKeys.resolvers,
    queryFn: () => fetchAllResolvers(),
    staleTime: staleTimes.lookup,
  })

  const engines = enginesQuery.data ?? []
  const resolvers = resolversQuery.data ?? []

  return (
    <Page title="Plugins" description="Engines and resolvers registered with the recorder. Read-only.">
      <PluginPanel
        title="Engines"
        tagsLabel="Capabilities"
        variant="engines"
        entries={engines.map(toEngineEntry)}
        isLoading={enginesQuery.isLoading}
        isError={enginesQuery.isError}
        error={enginesQuery.error}
        onRetry={() => void enginesQuery.refetch()}
      />
      <PluginPanel
        title="Resolvers"
        tagsLabel="Config"
        variant="resolvers"
        entries={resolvers.map(toResolverEntry)}
        isLoading={resolversQuery.isLoading}
        isError={resolversQuery.isError}
        error={resolversQuery.error}
        onRetry={() => void resolversQuery.refetch()}
      />
    </Page>
  )
}

interface PluginPanelProps {
  readonly title: string
  readonly tagsLabel: string
  readonly variant: "engines" | "resolvers"
  readonly entries: readonly PluginEntry[]
  readonly isLoading: boolean
  readonly isError: boolean
  readonly error: unknown
  readonly onRetry: () => void
}

function PluginPanel({ title, tagsLabel, variant, entries, isLoading, isError, error, onRetry }: PluginPanelProps) {
  return (
    <Panel>
      <PanelHead title={title} />
      <PanelBody flush>
        {isLoading ? (
          <div className={panelBodyClass}>
            <SkeletonRows cols={4} />
          </div>
        ) : isError ? (
          <div className={panelBodyClass}>
            <ErrorPanel message={getErrorMessage(error, `Could not load ${title.toLowerCase()}`)} onRetry={onRetry} />
          </div>
        ) : entries.length === 0 ? (
          <EmptyState title={`No ${title.toLowerCase()}`} text="Nothing has been registered yet." />
        ) : (
          <>
            <div className="table-desktop block max-sm:hidden">
              <Table className="table-stable">
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th className={variant === "engines" ? "w-[112px]" : "w-[300px] max-[1180px]:w-[33%]"}>{tagsLabel}</Th>
                    <Th className="w-[150px] max-[1180px]:w-[17%]">Origin</Th>
                    <Th className="w-[230px] max-[1180px]:w-[25%]">Hash</Th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <Td>
                        <div>{entry.name}</div>
                        {entry.description !== undefined && entry.description !== "" ? (
                          <div className="text-dim">{entry.description}</div>
                        ) : null}
                      </Td>
                      <Td>
                        <EntryMeta entry={entry} />
                      </Td>
                      <Td>{entry.origin}</Td>
                      <Td>
                        <Hash value={entry.originHash} label={`${entry.name} origin hash`} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <motion.div className="cards-mobile hidden max-sm:flex max-sm:flex-col max-sm:gap-3 max-sm:p-3" variants={staggerContainer} initial="hidden" animate="visible">
              {entries.map((entry) => (
                <motion.article key={entry.id} className="entity-card flex flex-col gap-3 p-4 border border-line rounded-md bg-surface-2" variants={staggerItem}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-md font-semibold text-ink [overflow-wrap:anywhere]">{entry.name}</div>
                      {entry.description !== undefined && entry.description !== "" ? (
                        <div className="text-sm text-ink-muted">{entry.description}</div>
                      ) : null}
                    </div>
                    {entry.capabilities !== undefined ? (
                      <div className="capability-row flex items-center gap-1 shrink-0">
                        <CapabilityBadges entry={entry} />
                      </div>
                    ) : null}
                  </div>
                  <dl className="flex flex-col gap-2">
                    <div className="entity-card-fact flex flex-col gap-[2px] text-sm [&_dt]:text-ink-dim [&_dd]:text-ink [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere]">
                      <dt>Origin</dt>
                      <dd>{entry.origin}</dd>
                    </div>
                    <div className="entity-card-fact flex flex-col gap-[2px] text-sm [&_dt]:text-ink-dim [&_dd]:text-ink [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere]">
                      <dt>Hash</dt>
                      <dd>
                        <Hash value={entry.originHash} label={`${entry.name} origin hash`} />
                      </dd>
                    </div>
                  </dl>
                  {entry.configSchema !== undefined ? (
                    <JsonView value={entry.configSchema ?? {}} />
                  ) : null}
                </motion.article>
              ))}
            </motion.div>
          </>
        )}
      </PanelBody>
    </Panel>
  )
}
