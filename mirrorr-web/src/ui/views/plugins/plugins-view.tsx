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

const COLUMN_WIDTH = {
  capabilities: "112px",
  config: "42%",
  origin: "150px",
  hash: "230px",
} as const

function EntryMeta({ entry }: { readonly entry: PluginEntry }) {
  if (entry.capabilities !== undefined) {
    return (
      <div className="capability-stack">
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
        metaWidth={COLUMN_WIDTH.capabilities}
        entries={engines.map(toEngineEntry)}
        isLoading={enginesQuery.isLoading}
        isError={enginesQuery.isError}
        error={enginesQuery.error}
        onRetry={() => void enginesQuery.refetch()}
      />
      <PluginPanel
        title="Resolvers"
        tagsLabel="Config"
        metaWidth={COLUMN_WIDTH.config}
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
  readonly metaWidth: string
  readonly entries: readonly PluginEntry[]
  readonly isLoading: boolean
  readonly isError: boolean
  readonly error: unknown
  readonly onRetry: () => void
}

function PluginPanel({ title, tagsLabel, metaWidth, entries, isLoading, isError, error, onRetry }: PluginPanelProps) {
  return (
    <Panel>
      <PanelHead title={title} />
      <PanelBody flush>
        {isLoading ? (
          <div className="panel-body">
            <SkeletonRows cols={4} />
          </div>
        ) : isError ? (
          <div className="panel-body">
            <ErrorPanel message={getErrorMessage(error, `Could not load ${title.toLowerCase()}`)} onRetry={onRetry} />
          </div>
        ) : entries.length === 0 ? (
          <EmptyState title={`No ${title.toLowerCase()}`} text="Nothing has been registered yet." />
        ) : (
          <>
            <div className="table-desktop">
              <Table className="table-stable">
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th style={{ width: metaWidth }}>{tagsLabel}</Th>
                    <Th style={{ width: COLUMN_WIDTH.origin }}>Origin</Th>
                    <Th style={{ width: COLUMN_WIDTH.hash }}>Hash</Th>
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
            <motion.div className="cards-mobile" variants={staggerContainer} initial="hidden" animate="visible">
              {entries.map((entry) => (
                <motion.article key={entry.id} className="entity-card" variants={staggerItem}>
                  <div className="entity-card-head">
                    <div>
                      <div className="entity-card-title">{entry.name}</div>
                      {entry.description !== undefined && entry.description !== "" ? (
                        <div className="entity-card-desc">{entry.description}</div>
                      ) : null}
                    </div>
                  </div>
                  <dl className="entity-card-facts">
                    <div className="entity-card-fact">
                      <dt>Origin</dt>
                      <dd>{entry.origin}</dd>
                    </div>
                    <div className="entity-card-fact">
                      <dt>Hash</dt>
                      <dd>
                        <Hash value={entry.originHash} label={`${entry.name} origin hash`} />
                      </dd>
                    </div>
                  </dl>
                  <EntryMeta entry={entry} />
                </motion.article>
              ))}
            </motion.div>
          </>
        )}
      </PanelBody>
    </Panel>
  )
}
