import { useQuery } from "@tanstack/react-query"
import { motion } from "motion/react"
import { fetchAllEngines, fetchAllResolvers, getErrorMessage } from "@/api"
import { queryKeys, staleTimes } from "@/api/query-keys"
import type { Engine, Resolver } from "@/api/schemas"
import {
  EmptyState,
  ErrorPanel,
  Hash,
  Panel,
  PanelBody,
  PanelHead,
  SkeletonRows,
  Table,
  Td,
  Tag,
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
  readonly tags: readonly string[]
}

/** Property names are the only stable part of a free-form JSON schema. */
function sortedKeys(record: Record<string, unknown> | undefined): string[] {
  return record === undefined ? [] : Object.keys(record).sort()
}

function toEngineEntry(engine: Engine): PluginEntry {
  return {
    id: engine.id,
    name: engine.name,
    description: engine.description,
    origin: engine.origin,
    originHash: engine.origin_hash,
    tags: sortedKeys(engine.capabilities),
  }
}

function toResolverEntry(resolver: Resolver): PluginEntry {
  return {
    id: resolver.id,
    name: resolver.name,
    description: resolver.description,
    origin: resolver.origin,
    originHash: resolver.origin_hash,
    tags: sortedKeys(resolver.config_schema),
  }
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
        entries={engines.map(toEngineEntry)}
        isLoading={enginesQuery.isLoading}
        isError={enginesQuery.isError}
        error={enginesQuery.error}
        onRetry={() => void enginesQuery.refetch()}
      />
      <PluginPanel
        title="Resolvers"
        tagsLabel="Config"
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
  readonly entries: readonly PluginEntry[]
  readonly isLoading: boolean
  readonly isError: boolean
  readonly error: unknown
  readonly onRetry: () => void
}

function PluginPanel({ title, tagsLabel, entries, isLoading, isError, error, onRetry }: PluginPanelProps) {
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
              <Table>
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Origin</Th>
                    <Th>Hash</Th>
                    <Th>{tagsLabel}</Th>
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
                      <Td>{entry.origin}</Td>
                      <Td>
                        <Hash value={entry.originHash} label={`${entry.name} origin hash`} />
                      </Td>
                      <Td>
                        {entry.tags.length > 0 ? (
                          <div className="toolbar">
                            {entry.tags.map((tag) => (
                              <Tag key={tag}>{tag}</Tag>
                            ))}
                          </div>
                        ) : null}
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
                  {entry.tags.length > 0 ? (
                    <div className="toolbar">
                      {entry.tags.map((tag) => (
                        <Tag key={tag}>{tag}</Tag>
                      ))}
                    </div>
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
