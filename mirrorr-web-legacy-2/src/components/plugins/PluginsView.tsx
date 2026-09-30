/**
 * V9 — the read-only plugin catalog (spec L303-L337 + L395).
 *
 * Engines and resolvers are introspected, never edited: capability badges,
 * copyable origin hashes, expandable JSON schemas, and the discovery note.
 */
import { useQuery } from "@tanstack/react-query"
import { Copy, Plug } from "lucide-react"
import { Button } from "@/components/ui/Button"
import { EmptyState, EMPTY_STATES } from "@/components/ui/EmptyState"
import { ErrorPanel } from "@/components/ui/ErrorPanel"
import { SkeletonRows, SKELETON_PRESETS } from "@/components/ui/SkeletonRows"
import { copyText } from "@/lib/clipboard"
import { userMessageForError } from "@/lib/errors"
import { QUERY_STALE_TIMES_MS, queryKeys } from "@/lib/query-keys"
import type { Engine, Resolver } from "@/lib/schemas/plugins"
import { fetchAllEngines, fetchAllResolvers } from "@/lib/sessions-api"
import { showToast } from "@/lib/toast"

export const PLUGINS_DISCOVERY_NOTE = "Plugins are discovered at server boot"
export const ORIGIN_HASH_COPIED_MESSAGE = "Origin hash copied"
export const ORIGIN_HASH_COPY_FAILED_MESSAGE = "Could not copy the origin hash"
export const NO_RESOLVERS_MESSAGE = "No resolvers installed"

const ORIGIN_HASH_PREVIEW_LENGTH = 12

interface CapabilityBadge {
  readonly key: string
  readonly enabled: boolean
  readonly label: string
}

function capabilityBadges(engine: Engine): readonly CapabilityBadge[] {
  const capabilities = engine.capabilities
  return [
    { key: "can_record", enabled: capabilities?.can_record !== false, label: "Record" },
    { key: "can_playlist", enabled: capabilities?.can_playlist !== false, label: "Playlist" },
  ]
}

function OriginHash({ name, hash, onCopy }: { name: string; hash: string; onCopy: (hash: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-small text-text-secondary" title={hash}>
        {hash.slice(0, ORIGIN_HASH_PREVIEW_LENGTH)}…
      </span>
      <Button
        size="sm"
        variant="ghost"
        icon={Copy}
        aria-label={`Copy origin hash for ${name}`}
        onClick={() => onCopy(hash)}
      />
    </div>
  )
}

function EngineCard({ engine, onCopyHash }: { engine: Engine; onCopyHash: (hash: string) => void }) {
  const modes = Object.entries(engine.retry_modes_schema ?? {})
  return (
    <article
      data-testid={`engine-card-${engine.id}`}
      className="flex flex-col gap-3 rounded-surface border border-border bg-bg-raised p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-body font-medium text-text-primary">{engine.name}</h3>
        {capabilityBadges(engine).map((badge) => (
          <span
            key={badge.key}
            className={
              badge.enabled
                ? "inline-flex items-center rounded-pill bg-ok/12 px-2 py-0.5 text-micro font-medium text-ok"
                : "inline-flex items-center rounded-pill bg-bg-inset px-2 py-0.5 text-micro text-text-muted"
            }
          >
            {badge.enabled ? badge.label : `no ${badge.label.toLowerCase()}`}
          </span>
        ))}
      </div>
      {engine.description === undefined || engine.description === "" ? null : (
        <p className="text-small text-text-secondary">{engine.description}</p>
      )}
      <dl className="flex flex-col gap-1 text-small">
        <div className="flex items-center gap-2">
          <dt className="text-text-muted">Origin</dt>
          <dd className="font-mono text-text-secondary">{engine.origin ?? "—"}</dd>
        </div>
        {engine.origin_hash === undefined || engine.origin_hash === "" ? null : (
          <div className="flex items-center gap-2">
            <dt className="text-text-muted">Origin hash</dt>
            <dd>
              <OriginHash name={engine.name} hash={engine.origin_hash} onCopy={onCopyHash} />
            </dd>
          </div>
        )}
      </dl>
      {modes.length === 0 ? null : (
        <details className="rounded-control border border-border bg-bg-base">
          <summary className="cursor-pointer px-3 py-2 text-small font-medium text-text-secondary">Retry modes</summary>
          <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
            {modes.map(([mode, entry]) => (
              <div key={mode} className="flex flex-col gap-1">
                <h4 className="text-label text-text-secondary">{mode}</h4>
                <pre
                  data-testid={`engine-retry-schema-${mode}`}
                  className="overflow-x-auto rounded-control bg-bg-inset p-2 font-mono text-small text-text-secondary"
                >
                  {JSON.stringify(entry?.schema ?? {}, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </details>
      )}
    </article>
  )
}

function ResolverCard({ resolver, onCopyHash }: { resolver: Resolver; onCopyHash: (hash: string) => void }) {
  return (
    <article
      data-testid={`resolver-card-${resolver.id}`}
      className="flex flex-col gap-3 rounded-surface border border-border bg-bg-raised p-4"
    >
      <h3 className="text-body font-medium text-text-primary">{resolver.name}</h3>
      {resolver.description === undefined || resolver.description === "" ? null : (
        <p className="text-small text-text-secondary">{resolver.description}</p>
      )}
      <dl className="flex flex-col gap-1 text-small">
        <div className="flex items-center gap-2">
          <dt className="text-text-muted">Origin</dt>
          <dd className="font-mono text-text-secondary">{resolver.origin ?? "—"}</dd>
        </div>
        {resolver.origin_hash === undefined || resolver.origin_hash === "" ? null : (
          <div className="flex items-center gap-2">
            <dt className="text-text-muted">Origin hash</dt>
            <dd>
              <OriginHash name={resolver.name} hash={resolver.origin_hash} onCopy={onCopyHash} />
            </dd>
          </div>
        )}
      </dl>
      <details className="rounded-control border border-border bg-bg-base">
        <summary className="cursor-pointer px-3 py-2 text-small font-medium text-text-secondary">Config schema</summary>
        <pre
          data-testid="resolver-config-schema"
          className="overflow-x-auto rounded-control bg-bg-inset p-2 font-mono text-small text-text-secondary"
        >
          {JSON.stringify(resolver.config_schema ?? {}, null, 2)}
        </pre>
      </details>
    </article>
  )
}

export function PluginsView() {
  const enginesQuery = useQuery({
    queryKey: queryKeys.engines(),
    queryFn: ({ signal }) => fetchAllEngines(signal),
    staleTime: QUERY_STALE_TIMES_MS.engines,
  })
  const resolversQuery = useQuery({
    queryKey: queryKeys.resolvers(),
    queryFn: ({ signal }) => fetchAllResolvers(signal),
    staleTime: QUERY_STALE_TIMES_MS.resolvers,
  })

  const engines = enginesQuery.data ?? []
  const resolvers = resolversQuery.data ?? []
  const error = enginesQuery.error ?? resolversQuery.error

  async function copyHash(hash: string) {
    const copied = await copyText(hash)
    showToast(copied ? ORIGIN_HASH_COPIED_MESSAGE : ORIGIN_HASH_COPY_FAILED_MESSAGE, copied ? "info" : "error")
  }

  return (
    <main data-testid="plugins-view" className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-title font-semibold text-text-primary">Plugins</h1>
      </div>

      {error ? (
        <ErrorPanel
          message={userMessageForError(error)}
          onRetry={() => {
            void enginesQuery.refetch()
            void resolversQuery.refetch()
          }}
        />
      ) : null}

      {enginesQuery.isPending || resolversQuery.isPending ? (
        <SkeletonRows {...SKELETON_PRESETS.recordings} label="Loading plugins" />
      ) : null}

      {enginesQuery.isPending || resolversQuery.isPending ? null : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-heading font-medium text-text-primary">Engines</h2>
            {engines.length === 0 ? (
              <EmptyState title={EMPTY_STATES.engines} icon={Plug} />
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
                {engines.map((engine) => (
                  <EngineCard key={engine.id} engine={engine} onCopyHash={(hash) => void copyHash(hash)} />
                ))}
              </div>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-heading font-medium text-text-primary">Resolvers</h2>
            {resolvers.length === 0 ? (
              <EmptyState title={NO_RESOLVERS_MESSAGE} icon={Plug} />
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
                {resolvers.map((resolver) => (
                  <ResolverCard key={resolver.id} resolver={resolver} onCopyHash={(hash) => void copyHash(hash)} />
                ))}
              </div>
            )}
          </section>

          <p className="text-small text-text-muted">{PLUGINS_DISCOVERY_NOTE}</p>
        </>
      )}
    </main>
  )
}
