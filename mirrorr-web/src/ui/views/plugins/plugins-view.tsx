import { useId, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { motion } from "motion/react"
import { fetchAllEngines, fetchAllResolvers, getErrorMessage } from "@/api"
import { queryKeys, staleTimes } from "@/api/query-keys"
import type { Capabilities, Engine, Resolver } from "@/api/schemas"
import {
  Badge,
  Banner,
  EmptyState,
  Hash,
  IconAlert,
  IconPlugins,
  JsonView,
  Panel,
  PanelBody,
  QueryState,
  RowActions,
  Skeleton,
  Table,
  Tag,
  Td,
  Th,
  toast,
} from "@/ui/components"
import { copyText } from "@/ui/lib/clipboard"
import { ConfigRow, DisclosureToggle } from "@/ui/views/shared/list-rows"
import { staggerContainer, staggerItem } from "@/ui/lib/motion"
import { Page } from "@/ui/views/shared/page"

/**
 * Plugins — the read-only inventory of engines and resolvers.
 *
 * One table rather than two panels, because the two kinds answer the same
 * question ("what is installed, from where, and does it support streaming?")
 * and shared a column grid badly: two headings turned one list into two, and
 * the resolver panel showed raw config where the engine panel showed badges,
 * so the same column meant two things depending on which panel you were in.
 */

type PluginKind = "engine" | "resolver"

interface PluginEntry {
  /** Unique per row — ids are only unique within a kind. */
  readonly key: string
  readonly id: number
  readonly kind: PluginKind
  readonly name: string
  readonly description?: string
  readonly origin: string
  readonly originHash: string
  readonly capabilities?: Capabilities
  readonly configSchema?: Record<string, unknown>
}

function toEngineEntry(engine: Engine): PluginEntry {
  return {
    key: `engine-${engine.id}`,
    id: engine.id,
    kind: "engine",
    name: engine.name,
    description: engine.description,
    origin: engine.origin,
    originHash: engine.origin_hash,
    capabilities: engine.capabilities ?? {},
  }
}

function toResolverEntry(resolver: Resolver): PluginEntry {
  return {
    key: `resolver-${resolver.id}`,
    id: resolver.id,
    kind: "resolver",
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

const KIND_LABEL: Record<PluginKind, string> = { engine: "Engine", resolver: "Resolver" }

function CapabilityBadges({ entry }: { readonly entry: PluginEntry }) {
  if (entry.capabilities === undefined) return <span className="text-dim">—</span>
  return (
    <div className="flex flex-wrap items-center gap-1">
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

/**
 * Config is a disclosure, not a cell body and not a popover.
 *
 * Inline JSON makes every row a different height; a popover inside the table
 * would be clipped by the scroll container the table lives in. The expanded
 * panel is a second `<tr>` spanning the grid, so the schema can use the width
 * the row cannot give it and the columns stay aligned.
 */
function ConfigToggle({
  entry,
  expanded,
  controls,
  onToggle,
}: {
  readonly entry: PluginEntry
  readonly expanded: boolean
  readonly controls: string
  readonly onToggle: () => void
}) {
  if (entry.configSchema === undefined || Object.keys(entry.configSchema).length === 0) {
    return <span className="text-dim">—</span>
  }
  return (
    <div className="flex items-center gap-2">
      <DisclosureToggle
        open={expanded}
        controls={controls}
        label={`${expanded ? "Hide" : "Show"} config for ${entry.name}`}
        onToggle={onToggle}
      />
      <span className="text-sm text-ink-muted">JSON</span>
    </div>
  )
}

function copyHash(entry: PluginEntry): void {
  void copyText(entry.originHash)
    .then(() => toast.success("Copied", `${entry.name} hash`))
    .catch(() => toast.error("Could not copy", "Clipboard access was denied."))
}

/**
 * The overflow of a read-only row: the two values a reader actually copies out
 * of this page. Everything on this surface is inventory, so there is no edit or
 * delete to offer — an empty menu would be worse than none.
 */
function pluginActions(entry: PluginEntry) {
  const schema = entry.configSchema
  return [
    { label: "Copy hash", onSelect: () => copyHash(entry) },
    ...(schema === undefined || Object.keys(schema).length === 0
      ? []
      : [
          {
            label: "Copy config",
            onSelect: () => {
              void copyText(JSON.stringify(schema, null, 2))
                .then(() => toast.success("Copied JSON", `${entry.name} config`))
                .catch(() => toast.error("Could not copy", "Clipboard access was denied."))
            },
          },
        ]),
  ] as const
}

function PluginName({ entry }: { readonly entry: PluginEntry }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink [overflow-wrap:anywhere]">{entry.name}</span>
        <Tag>{entry.origin}</Tag>
      </div>
      {entry.description !== undefined && entry.description !== "" ? (
        <div className="mt-0.5 text-sm text-dim [overflow-wrap:anywhere]">{entry.description}</div>
      ) : null}
    </div>
  )
}

function SharedHashMark({ hashes }: { readonly hashes: readonly string[] }) {
  if (hashes.length === 0) return null
  return (
    <span
      className="ml-1 inline-flex items-center gap-1 text-warning"
      title={`Shared hash with ${hashes.join(", ")}`}
    >
      <IconAlert size={14} />
      <span className="text-sm font-semibold">Duplicate hash</span>
      <span className="sr-only">Shared with {hashes.join(", ")}</span>
    </span>
  )
}

function PluginRow({
  entry,
  sharedHashes,
  expanded,
  onToggleExpanded,
}: {
  readonly entry: PluginEntry
  readonly sharedHashes: readonly string[]
  readonly expanded: boolean
  readonly onToggleExpanded: () => void
}) {
  const configId = useId()
  return (
    <>
      <tr data-id={entry.key}>
        <Td>
          <PluginName entry={entry} />
        </Td>
        <Td>
          <Tag accent={entry.kind === "engine"}>{KIND_LABEL[entry.kind]}</Tag>
        </Td>
        <Td>
          <CapabilityBadges entry={entry} />
        </Td>
        <Td>
          <div className="flex flex-wrap items-center">
            <Hash value={entry.originHash} label={`${entry.name} origin hash`} className="min-h-6" />
            <SharedHashMark hashes={sharedHashes} />
          </div>
        </Td>
        <Td>
          <ConfigToggle
            entry={entry}
            expanded={expanded}
            controls={configId}
            onToggle={onToggleExpanded}
          />
        </Td>
        <Td actions>
          <RowActions label={`Actions for ${entry.name}`} actions={pluginActions(entry)} />
        </Td>
      </tr>
      {expanded && entry.configSchema !== undefined ? (
        <ConfigRow id={configId} columns={6}>
          <JsonView value={entry.configSchema} label={`${entry.name} config schema`} defaultOpen />
        </ConfigRow>
      ) : null}
    </>
  )
}

function PluginCard({ entry, sharedHashes }: { readonly entry: PluginEntry; readonly sharedHashes: readonly string[] }) {
  return (
    <motion.article
      variants={staggerItem}
      data-id={entry.key}
      className="flex flex-col gap-3 rounded-md border border-line bg-surface-2 p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <PluginName entry={entry} />
        <Tag accent={entry.kind === "engine"}>{KIND_LABEL[entry.kind]}</Tag>
      </div>
      {entry.capabilities !== undefined ? <CapabilityBadges entry={entry} /> : null}
      <dl className="flex flex-col gap-2 text-sm [&_dt]:text-ink-dim">
        <div className="flex flex-col gap-[2px]">
          <dt>Hash</dt>
          <dd className="flex flex-wrap items-center">
            <Hash value={entry.originHash} label={`${entry.name} origin hash`} className="min-h-6" />
            <SharedHashMark hashes={sharedHashes} />
          </dd>
        </div>
      </dl>
      {entry.configSchema !== undefined && Object.keys(entry.configSchema).length > 0 ? (
        <details className="border-t border-line-subtle pt-2">
          <summary className="tab-stop cursor-pointer text-sm text-ink-muted">Config</summary>
          <div className="mt-2">
            <JsonView value={entry.configSchema} label={`${entry.name} config schema`} defaultOpen />
          </div>
        </details>
      ) : null}
      <div className="flex justify-end">
        <RowActions label={`Actions for ${entry.name}`} actions={pluginActions(entry)} />
      </div>
    </motion.article>
  )
}

function PluginSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading plugins"
      className="flex flex-col gap-3 rounded-md border border-line bg-surface-1 p-4"
    >
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="flex h-8 items-center gap-4">
          <Skeleton width="22%" height={12} />
          <Skeleton width="9%" height={12} />
          <Skeleton width="16%" height={12} />
          <Skeleton width="20%" height={12} />
          <Skeleton width="8%" height={12} />
        </div>
      ))}
    </div>
  )
}

/**
 * Hashes that appear on more than one row. Two plugins built from the same file
 * is a fact worth surfacing — a stale duplicate shadows the one you think you
 * are using, and the row that loses is chosen by registration order, not by you.
 */
function duplicateHashes(entries: readonly PluginEntry[]): Map<string, string[]> {
  const byHash = new Map<string, string[]>()
  for (const entry of entries) {
    const names = byHash.get(entry.originHash) ?? []
    names.push(entry.name)
    byHash.set(entry.originHash, names)
  }
  const duplicates = new Map<string, string[]>()
  for (const [hash, names] of byHash) if (names.length > 1) duplicates.set(hash, names)
  return duplicates
}

export function PluginsView() {
  // The same query keys/queryFns as `useEngines`/`useResolvers`, subscribed
  // directly so the page can render one gate over both lists.
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

  const entries = useMemo(
    () => [
      ...(enginesQuery.data ?? []).map(toEngineEntry),
      ...(resolversQuery.data ?? []).map(toResolverEntry),
    ],
    [enginesQuery.data, resolversQuery.data],
  )
  const duplicates = useMemo(() => duplicateHashes(entries), [entries])
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>())

  const toggleExpanded = (key: string): void =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  // One gate for two requests: half a table would misrepresent what is
  // installed, so any failure is the whole page's failure.
  const query = {
    isLoading: enginesQuery.isLoading || resolversQuery.isLoading,
    isError: enginesQuery.isError || resolversQuery.isError,
    error: enginesQuery.error ?? resolversQuery.error,
    refetch: () => {
      void enginesQuery.refetch()
      void resolversQuery.refetch()
    },
  }

  return (
    <Page title="Plugins" description="Engines and resolvers registered with the recorder. Read-only.">
      <QueryState
        query={query}
        loading={<PluginSkeleton />}
        isEmpty={entries.length === 0}
        empty={
          <EmptyState
            icon={<IconPlugins size={22} />}
            title="No plugins registered"
            text="Engines and resolvers appear here once the recorder registers them."
          />
        }
        errorMessage={getErrorMessage(query.error, "Could not load plugins")}
        onRetry={query.refetch}
      >
        {duplicates.size > 0 ? (
          <Banner kind="warning" title="Two plugins share a hash">
            {[...duplicates.entries()].map(([hash, names]) => (
              <span key={hash} className="block">
                <code className="[font-family:var(--font-mono)]">{hash.slice(0, 12)}…</code> — {names.join(", ")}
              </span>
            ))}
          </Banner>
        ) : null}

        <Panel>
          <PanelBody flush>
            <div className="hidden min-[672px]:block">
              <Table>
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th className="w-[96px]">Kind</Th>
                    <Th className="w-[132px]">Capabilities</Th>
                    <Th className="w-[220px] max-[1180px]:w-[25%]">Hash</Th>
                    <Th className="w-[96px]">Config</Th>
                    <Th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <PluginRow
                      key={entry.key}
                      entry={entry}
                      sharedHashes={duplicates.get(entry.originHash) ?? []}
                      expanded={expanded.has(entry.key)}
                      onToggleExpanded={() => toggleExpanded(entry.key)}
                    />
                  ))}
                </tbody>
              </Table>
            </div>

            <motion.div
              className="flex flex-col gap-2 p-3 min-[672px]:hidden"
              variants={staggerContainer}
              initial="hidden"
              animate="visible"
            >
              {entries.map((entry) => (
                <PluginCard key={entry.key} entry={entry} sharedHashes={duplicates.get(entry.originHash) ?? []} />
              ))}
            </motion.div>
          </PanelBody>
        </Panel>
      </QueryState>
    </Page>
  )
}
